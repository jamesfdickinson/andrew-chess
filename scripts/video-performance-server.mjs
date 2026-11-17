import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { localVideoPath } from './video-processing.mjs';
import { analyzeVideoPerformance, videoPerformanceStatus, videoModels, performanceRequestZip } from './video-performance.mjs';
import { persistAnalysisJob, listAnalysisJobs } from './analysis-jobs.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';
import { matchPerformance, generationCandidates, actingModes } from '../src/performance-matching.js';
import { readFrameSets, frameSetStatus, queueFrameSets, approveFrameSet } from './frame-sets.mjs';
import { performanceById } from '../src/performance-catalog.js';
import { coreReference, saveCoreReference } from './coach-reference.mjs';

export function videoPerformanceServer(root, { analyze = analyzeVideoPerformance, readiness = videoPerformanceStatus, exportZip = performanceRequestZip, imageOptions } = {}) {
  const jobs = new Map(); let queue = Promise.resolve();
  async function schedule(id, saved, analysis, data) {
    const existing = jobs.get(id);
    if (existing?.source === saved.original && ['queued', 'running'].includes(existing.status)) return existing;
    const reference = saved.videoPerformance;
    const job = { id: randomUUID(), phraseId: id, source: saved.original, operation: 'analyze-video', status: 'queued', stage: 'Video gestures queued', pid: process.pid, startedAt: new Date().toISOString() };
    jobs.set(id, job);
    const persist = () => persistAnalysisJob(root, job);
    await persist();
    queue = queue.then(async () => {
      try {
        const currentTake = (await readRecordings(root))[id];
        if (currentTake?.original !== saved.original || currentTake.analysis?.revision !== saved.analysis?.revision) { job.status = 'superseded'; job.stage = 'Take or wording changed before video analysis started'; await persist(); return; }
        job.status = 'running'; await persist();
        const plan = await analyze(root, analysis, { id: job.id, model: data.model, acting: 'gestures', progress: async stage => { job.stage = stage; await persist(); } });
        let attached = false;
        await updateRecordings(root, current => {
          if (current[id]?.original !== saved.original || JSON.stringify(current[id]?.videoPerformance) !== JSON.stringify(reference) || current[id]?.analysis?.revision !== saved.analysis?.revision) return;
          current[id].videoPerformance = { id: plan.id, source: saved.original, url: `/coach/shared/video-performance/${plan.id}/plan.json` }; attached = true;
        });
        job.status = attached ? 'complete' : 'superseded';
        job.stage = attached ? 'Video gestures ready · wording emotions retained' : 'Take or wording changed; video results retained separately';
        if (attached && data.autoGenerate && (await readRecordings(root))[id]?.original === saved.original) {
          const core = await coreReference(root);
          const matched = matchPerformance(plan, await readFrameSets(root), { referenceId: core.id });
          const queued = await queueFrameSets(root, generationCandidates(matched), { ...imageOptions, reference: core, limit: 96 });
          if (queued.length) job.stage = `Video gestures ready · ${queued.length} frame sets queued`;
        }
      } catch (error) { job.status = 'failed'; job.stage = error.message; }
      await persist();
    }).catch(() => { job.status = 'failed'; job.stage = 'Could not persist video analysis progress.'; });
    return job;
  }
  return async (req, res, url, send) => {
    if (url.pathname === '/api/recordings/coach-reference') {
      if (req.method === 'GET') { send(200, { reference: await coreReference(root) }); return true; }
      if (req.method !== 'POST') { send(405, { error: 'Method not supported.' }); return true; }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.headers['content-type'])) { send(415, { error: 'Choose a PNG, JPEG or WebP image.' }); return true; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) { send(413, { error: 'Reference image must be under 12 MB.' }); return true; } chunks.push(chunk); }
      try { send(200, { reference: await saveCoreReference(root, Buffer.concat(chunks)) }); }
      catch { send(400, { error: 'Could not read that reference image. Choose a valid PNG, JPEG or WebP.' }); }
      return true;
    }
    if (['/api/recordings/frame-sets', '/api/recordings/frame-sets/approve'].includes(url.pathname)) {
      if (req.method === 'GET' && url.pathname === '/api/recordings/frame-sets') {
        send(200, { ...await frameSetStatus(root), assets: await readFrameSets(root) }); return true;
      }
      if (req.method !== 'POST') { send(405, { error: 'Method not supported.' }); return true; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) { send(413, { error: 'Request too large.' }); return true; } }
      let data; try { data = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON.' }); return true; }
      if (url.pathname === '/api/recordings/frame-sets' && Array.isArray(data?.performanceIds)) {
        const ids = [...new Set(data.performanceIds)];
        if (!ids.length || ids.length > 96 || ids.some(id => typeof id !== 'string' || !Object.hasOwn(performanceById, id))) { send(400, { error: 'Choose valid performance options for this sequence.' }); return true; }
        const status = await frameSetStatus(root);
        if (data.referenceId !== status.reference.id) { send(409, { error: 'Coach reference changed. Select the sequence again to use the new reference.' }); return true; }
        if (!status.ready) { send(503, { error: 'Configure your OpenRouter key first.' }); return true; }
        const candidates = ids.map(id => ({ key: id, name: performanceById[id].label, speaking: performanceById[id].speaking }));
        const queued = await queueFrameSets(root, candidates, { ...imageOptions, reference: status.reference, limit: 96 });
        send(202, { queued, reference: status.reference, assets: await readFrameSets(root) }); return true;
      }
      const option = data && Object.hasOwn(performanceById, data.performanceId) ? performanceById[data.performanceId] : null;
      if (!option) { send(400, { error: 'Choose an available emotion and gesture option.' }); return true; }
      if (url.pathname.endsWith('/approve')) {
        const asset = (await readFrameSets(root)).find(item => item.currentReference !== false && (item.performanceId || item.key) === option.id);
        try { send(200, { assets: await approveFrameSet(root, asset?.key || option.id) }); }
        catch (error) { send(400, { error: error.message }); }
        return true;
      }
      if (!(await frameSetStatus(root)).ready) { send(503, { error: 'Configure your OpenRouter key first.' }); return true; }
      const queued = await queueFrameSets(root, [{ key: option.id, name: option.label, speaking: option.speaking }], imageOptions);
      send(202, { queued, assets: await readFrameSets(root) }); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/recordings/video-performance-status') { send(200, { ...await readiness(root), imageGeneration: await frameSetStatus(root) }); return true; }
    if (url.pathname === '/api/recordings/video-batch') {
      const recordings = await readRecordings(root);
      const candidates = Object.entries(recordings).filter(([id, saved]) => recordingPhrases.some(phrase => phrase.id === id) && saved.original && saved.analysis && saved.videoPerformance?.source !== saved.original && !['queued', 'running'].includes(jobs.get(id)?.status))
        .map(([id, saved]) => ({ id, source: saved.original, revision: saved.analysis.revision }));
      if (req.method === 'GET') {
        send(200, { candidates, waiting: Object.values(recordings).filter(saved => saved.original && !saved.analysis).length }); return true;
      }
      if (req.method !== 'POST') { send(405, { error: 'Method not supported.' }); return true; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 65536) { send(413, { error: 'Batch request too large.' }); return true; } }
      let data; try { data = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON.' }); return true; }
      if (!Array.isArray(data?.items) || data.items.length > recordingPhrases.length || !videoModels.some(model => model.id === data.model)) { send(400, { error: 'Choose current recordings and a supported video model.' }); return true; }
      if (!(await readiness(root)).ready) { send(503, { error: 'Configure OpenRouter first.' }); return true; }
      let queued = 0, skipped = 0;
      for (const item of data.items) {
        if (!item || !candidates.some(candidate => candidate.id === item.id && candidate.source === item.source && candidate.revision === item.revision)) { skipped++; continue; }
        const saved = recordings[item.id], analysis = JSON.parse(await readFile(localVideoPath(root, saved.analysis.url), 'utf8'));
        if (analysis.source !== saved.original) { skipped++; continue; }
        await schedule(item.id, saved, analysis, { model: data.model, autoGenerate: false }); queued++;
      }
      send(202, { queued, skipped }); return true;
    }
    const match = url.pathname.match(/^\/api\/recordings\/([a-z0-9-]+)\/(video-performance|analyze-video|video-artwork-export|create-frame-sets|approve-frame-set)$/);
    if (!match) return false;
    const [, id, operation] = match;
    const recordings = await readRecordings(root), saved = recordings[id];
    if (!recordingPhrases.some(phrase => phrase.id === id) || !saved?.original) { send(404, { error: 'Record this phrase first.' }); return true; }
    const reference = saved.videoPerformance;
    const readPlan = async () => reference?.source === saved.original ? matchPerformance(JSON.parse(await readFile(localVideoPath(root, reference.url), 'utf8')), await readFrameSets(root), { referenceId: (await coreReference(root)).id }) : null;
    if (req.method === 'GET' && operation === 'video-performance') {
      const job = jobs.get(id) || (await listAnalysisJobs(root, recordings)).find(job => job.phraseId === id && job.operation === 'analyze-video');
      send(200, { plan: await readPlan(), job: job?.source === saved.original ? job : null }); return true;
    }
    if (req.method === 'GET' && operation === 'video-artwork-export') {
      const plan = await readPlan();
      if (!plan) { send(409, { error: 'Analyze this video performance first.' }); return true; }
      const zip = await exportZip(root, plan);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}-artwork-requests.zip"`, 'Cache-Control': 'no-store' });
      res.end(zip); return true;
    }
    if (req.method !== 'POST' || !['analyze-video', 'create-frame-sets', 'approve-frame-set'].includes(operation)) { send(405, { error: 'Method not supported.' }); return true; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) { send(413, { error: 'Request too large.' }); return true; } }
    let data;
    try { data = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON.' }); return true; }
    if (operation !== 'analyze-video') {
      const plan = await readPlan();
      if (!plan || data?.source !== saved.original || data.planId !== plan.id) { send(409, { error: 'The take or video suggestions changed. Reload before generating artwork.' }); return true; }
      if (operation === 'approve-frame-set') {
        if (!plan.missingAssets.some(item => item.key === data.key)) { send(400, { error: 'This set does not belong to the current suggestions.' }); return true; }
        const asset = plan.missingAssets.find(item => item.key === data.key)?.record;
        try { await approveFrameSet(root, asset?.key || data.key); }
        catch (error) { send(400, { error: error.message }); return true; }
        send(200, { plan: await readPlan() }); return true;
      }
      if (!(await frameSetStatus(root)).ready) { send(503, { error: 'Configure your OpenRouter key before generating images.' }); return true; }
      const core = await coreReference(root);
      if (data.referenceId && data.referenceId !== core.id) { send(409, { error: 'Coach reference changed. Select the sequence again.' }); return true; }
      const queued = await queueFrameSets(root, generationCandidates(plan), { ...imageOptions, reference: core, limit: data.all === true ? 96 : 2 });
      send(202, { queued, plan: await readPlan() }); return true;
    }
    if (!data || data.source !== saved.original || !saved.analysis || data.analysisId !== saved.analysis.id || data.revision !== saved.analysis.revision) { send(409, { error: 'Save/reload the current analysis before analyzing the video.' }); return true; }
    if (!videoModels.some(item => item.id === data.model)) { send(400, { error: 'Choose a supported video model.' }); return true; }
    const acting = data.acting || 'expressive';
    if (!actingModes.includes(acting) || (data.autoGenerate !== undefined && typeof data.autoGenerate !== 'boolean')) { send(400, { error: 'Invalid acting or generation option.' }); return true; }
    const existing = jobs.get(id);
    if (existing?.source === saved.original && ['queued', 'running'].includes(existing.status)) { send(202, { job: existing }); return true; }
    const status = await readiness(root);
    if (!status.ready) { send(503, { error: status.message }); return true; }
    const analysis = JSON.parse(await readFile(localVideoPath(root, saved.analysis.url), 'utf8'));
    if (analysis.source !== saved.original) { send(409, { error: 'Analyze the current recording first.' }); return true; }
    const job = await schedule(id, saved, analysis, { ...data, acting });
    send(202, { job }); return true;
  };
}
