import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { analyzeRecording, speechStatus } from './analyze-recording.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';
import { validateTimeline, timelineCues, mouthSync } from '../src/animation-timeline.js';
import { localVideoPath } from './video-processing.mjs';
import { reviewZip } from './review-zip.mjs';
import { addEmotionPass, emotionStatus } from './analyze-emotion.mjs';
import { persistAnalysisJob, listAnalysisJobs } from './analysis-jobs.mjs';
import { coreReference } from './coach-reference.mjs';
import { readFrameSets, queueFrameSets, frameSetStatus } from './frame-sets.mjs';
import { resolveTimelineArtwork } from '../src/performance-matching.js';

export function analysisServer(root, { analyze = analyzeRecording, readiness = speechStatus, emotions = addEmotionPass, emotionReadiness = emotionStatus, imageOptions } = {}) {
  const jobs = new Map();
  let queue = Promise.resolve();
  return async (req, res, url, send) => {
    if (url.pathname === '/api/recordings/analysis-jobs' && req.method === 'GET') { send(200, { jobs: await listAnalysisJobs(root, await readRecordings(root)) }); return true; }
    if (url.pathname === '/api/recordings/speech-status' && req.method === 'GET') { send(200, await readiness(root)); return true; }
    if (url.pathname === '/api/recordings/emotion-status' && req.method === 'GET') { send(200, await emotionReadiness(root)); return true; }
    const match = url.pathname.match(/^\/api\/recordings\/([a-z0-9-]+)\/(analysis|analyze|emotions|timeline|review-export)$/);
    if (!match) return false;
    const [, id, operation] = match;
    const phrase = recordingPhrases.find(item => item.id === id);
    if (!phrase) { send(404, { error: 'Unknown phrase.' }); return true; }
    const saved = (await readRecordings(root))[id];
    if (!saved?.original) { send(404, { error: 'Record or upload this phrase first.' }); return true; }
    const reference = saved.analysis;
    const readAnalysis = async () => reference?.url ? JSON.parse(await readFile(localVideoPath(root, reference.url), 'utf8')) : null;
    if (req.method === 'GET' && operation === 'analysis') {
      const job = jobs.get(id) || (await listAnalysisJobs(root, await readRecordings(root))).find(item => item.phraseId === id && item.operation !== 'analyze-video');
      const currentJob = job?.source === saved.original ? job : null;
      const preview = currentJob?.preview ? JSON.parse(await readFile(localVideoPath(root, currentJob.preview.url), 'utf8')) : null;
      send(200, { job: currentJob, analysis: await readAnalysis(), preview }); return true;
    }
    if (req.method === 'GET' && operation === 'review-export') {
      const analysis = await readAnalysis();
      if (!analysis || analysis.source !== saved.original) { send(409, { error: 'Analyze the current take first.' }); return true; }
      const zip = await reviewZip(root, analysis);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}-review.zip"`, 'Cache-Control': 'no-store' }); res.end(zip); return true;
    }
    if (req.method !== 'POST' || !['analyze', 'emotions', 'timeline'].includes(operation)) { send(405, { error: 'Method not supported.' }); return true; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1024 * 1024) { send(413, { error: 'Request too large.' }); return true; } }
    let data;
    try { data = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON.' }); return true; }
    if (!data || data.source !== saved.original) { send(409, { error: 'This take changed. Reload its analysis.' }); return true; }
    if (data.useAutomatically !== undefined && typeof data.useAutomatically !== 'boolean') { send(400, { error: 'Invalid automatic animation option.' }); return true; }
    if (data.autoCreateArtwork !== undefined && typeof data.autoCreateArtwork !== 'boolean') { send(400, { error: 'Invalid automatic artwork option.' }); return true; }
    if (['analyze', 'emotions'].includes(operation)) {
      const prior = operation === 'emotions' ? await readAnalysis() : null;
      if (operation === 'emotions' && (!prior || prior.source !== saved.original || data.analysisId !== prior.id || data.revision !== prior.revision)) { send(409, { error: 'Analysis changed. Reload before running emotion analysis.' }); return true; }
      if (!(operation === 'analyze' && saved.generatedText) && !(await (operation === 'emotions' ? emotionReadiness : readiness)(root)).ready) { send(503, { error: operation === 'emotions' ? 'Local emotion model is not ready. Run npm run emotion:setup.' : 'Local speech is not ready. Run npm run speech:setup.' }); return true; }
      const existing = jobs.get(id);
      if (existing?.source === saved.original && ['queued', 'running'].includes(existing.status)) { send(202, { job: existing }); return true; }
      const job = { id: randomUUID(), phraseId: id, source: saved.original, status: 'queued', stage: 'Queued', operation, pid: process.pid, startedAt: new Date().toISOString() };
      jobs.set(id, job);
      const directory = localVideoPath(root, `/coach/shared/analysis/${job.id}`);
      await mkdir(directory, { recursive: true });
      const persist = async () => { await writeFile(path.join(directory, 'job.json'), JSON.stringify(job, null, 2)); await persistAnalysisJob(root, job); };
      await persist();
      queue = queue.then(async () => {
        try {
          job.status = 'running'; await persist();
          const progress = async stage => { job.stage = stage; await persist(); };
          const analysis = operation === 'emotions' ? await emotions(root, prior, { progress }) : await analyze(root, phrase, saved, { id: job.id, progress, reviewMedia: data.reviewMedia === true,
            onPreviewReady: async preview => { job.preview = preview; await persist(); } });
          const analysisUrl = operation === 'emotions' ? `/coach/shared/analysis/${analysis.id}/revision-${analysis.revision}.json` : `/coach/shared/analysis/${analysis.id}/analysis.json`;
          if (operation === 'emotions') await writeFile(localVideoPath(root, analysisUrl), JSON.stringify(analysis, null, 2));
          const core = await coreReference(root);
          const artwork = resolveTimelineArtwork(analysis.timeline, await readFrameSets(root), core.id);
          if (operation === 'analyze' && core.id !== 'original' && !artwork.requirements.length) {
            analysis.timeline = artwork.timeline;
            await writeFile(localVideoPath(root, analysisUrl), JSON.stringify(analysis, null, 2));
          }
          let attached = false, usedAutomatically = false;
          await updateRecordings(root, recordings => {
            if (recordings[id]?.original !== saved.original || JSON.stringify(recordings[id]?.analysis) !== JSON.stringify(reference)) return;
            recordings[id].analysis = { id: analysis.id, url: analysisUrl, revision: analysis.revision };
            recordings[id].mouthSync = mouthSync(analysis);
            const currentAnimation = recordings[id].animation;
            const spokenText = (analysis.spokenText ?? analysis.transcript?.text ?? '').trim();
            if (operation === 'analyze' && data.useAutomatically && !artwork.requirements.length && spokenText &&
                (!currentAnimation || currentAnimation.source !== saved.original || currentAnimation.automatic === true)) {
              const timeline = validateTimeline(analysis.timeline, analysis.duration);
              recordings[id].animation = { source: saved.original, analysisId: analysis.id, revision: analysis.revision, spokenText,
                automatic: true, createdAt: new Date().toISOString(), cues: timelineCues(timeline, analysis.envelope, analysis.duration), endingEmotion: timeline.at(-1).emotion };
              usedAutomatically = true;
            }
            attached = true;
          });
          job.status = attached ? 'complete' : 'superseded'; job.stage = attached ? (operation === 'emotions' ? 'Vocal-emotion suggestions ready; existing animation choices retained' : usedAutomatically ? 'Animation ready in game · adjustments optional' : 'Draft ready') : 'Take or timeline changed; results retained in the analysis folder.';
          if (attached && operation === 'analyze' && artwork.requirements.length) {
            job.stage = `Lip timing ready · ${artwork.requirements.length} frame sets needed for this coach reference`;
            if (data.autoCreateArtwork && (await readRecordings(root))[id]?.original === saved.original && (await frameSetStatus(root)).ready) {
              const queued = await queueFrameSets(root, artwork.requirements.filter(item => item.status === 'missing'), { ...imageOptions, reference: core, limit: 96 });
              job.stage = queued.length ? `Lip timing ready · ${queued.length} frame sets queued for this coach reference` : 'Lip timing ready · artwork is already queued or awaiting review';
            }
          }
        } catch (error) { job.status = 'failed'; job.stage = error.message; }
        await persist();
      }).catch(error => { job.status = 'failed'; job.stage = error.message; });
      send(202, { job }); return true;
    }
    const analysis = await readAnalysis();
    if (!analysis || data.analysisId !== analysis.id || data.revision !== analysis.revision || analysis.source !== saved.original) { send(409, { error: 'Analysis changed. Reload before saving; your imported edits have not been applied.' }); return true; }
    let timeline;
    try { timeline = validateTimeline(data.timeline, analysis.duration); }
    catch (error) { send(400, { error: error.message }); return true; }
    const spokenText = typeof data.spokenText === 'string' ? data.spokenText.trim() : analysis.spokenText ?? analysis.transcript.text;
    if (!spokenText || spokenText.length > 10000) { send(400, { error: 'Enter the actor’s actual spoken line (up to 10,000 characters).' }); return true; }
    if (data.approve && timeline.some(segment => segment.needsReview)) { send(400, { error: 'Review and clear flagged segments before approving.' }); return true; }
    const edited = { ...analysis, timeline, spokenText, revision: randomUUID(), status: data.approve ? 'approved' : 'draft', editedAt: new Date().toISOString() };
    const editedUrl = `/coach/shared/analysis/${analysis.id}/revision-${edited.revision}.json`;
    await writeFile(localVideoPath(root, editedUrl), JSON.stringify(edited, null, 2));
    let conflict = false;
    await updateRecordings(root, recordings => {
      if (recordings[id]?.original !== saved.original || recordings[id]?.analysis?.revision !== reference.revision) { conflict = true; return; }
      recordings[id].analysis = { id: analysis.id, url: editedUrl, revision: edited.revision };
      if (data.approve) recordings[id].animation = { source: saved.original, analysisId: analysis.id, revision: edited.revision, spokenText, approvedAt: edited.editedAt,
        cues: timelineCues(timeline, analysis.envelope, analysis.duration), endingEmotion: timeline.at(-1).emotion };
    });
    send(conflict ? 409 : 200, conflict ? { error: 'This take changed while saving. Reload before retrying.' } : { analysis: edited }); return true;
  };
}
