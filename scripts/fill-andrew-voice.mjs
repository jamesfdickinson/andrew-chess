import { mediaFile } from './media-paths.mjs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { coachContext, coachBase, readCoaches } from './coach-profiles.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { generateVoice, fishStatus } from './coach-voice.mjs';
import { analyzeRecording } from './analyze-recording.mjs';
import { coreReference } from './coach-reference.mjs';
import { readFrameSets } from './frame-sets.mjs';
import { resolveTimelineArtwork } from '../src/performance-matching.js';
import { mouthSync, timelineCues, validateTimeline } from '../src/animation-timeline.js';
import { recordingPhrases } from '../src/recording-phrases.js';

const root = process.cwd(), coachId = 'andrew';
await coachContext.run(coachId, async () => {
  const base = coachBase(), directory = mediaFile(root, base + '/' + 'voice-fill-v1');
  await mkdir(directory, { recursive: true });
  const statePath = path.join(directory, 'progress.json');
  let state;
  try { state = JSON.parse(await readFile(statePath)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const saved = await readRecordings(root);
    await writeFile(path.join(directory, 'recordings-before.json'), JSON.stringify(saved, null, 2), { flag: 'wx' });
    state = { startedAt: new Date().toISOString(), coachId, voiceId: (await readCoaches(root)).find(p => p.id === coachId).voiceId,
      items: recordingPhrases.filter(p => !saved[p.id]?.original).map(p => ({ id: p.id, text: p.text, status: 'pending' })) };
  }
  if (state.voiceId !== 'andrew-pilot-v1') throw new Error('Expected the approved Andrew pilot voice');
  const persist = () => writeFile(statePath, JSON.stringify(state, null, 2));
  await persist();
  const ready = await fishStatus(root, { refresh: true });
  if (!ready.ready) throw new Error(ready.message);
  const pilotDirectory = mediaFile(root, base + '/' + 'voice-pilot-v1');
  const pilot = JSON.parse(await readFile(path.join(pilotDirectory, 'manifest.json')));
  const core = await coreReference(root), library = await readFrameSets(root);
  for (const item of state.items) {
    if (item.status === 'complete' || item.status === 'preserved') continue;
    try {
      const current = (await readRecordings(root))[item.id];
      if (current?.original && current.original !== item.take?.original) {
        item.status = 'preserved'; await persist(); continue;
      }
      item.status = 'running'; delete item.error; await persist();
      console.log(`START ${state.items.filter(i => i.status === 'complete').length + 1}/${state.items.length} ${item.id}`);
      if (!item.take) {
        const sample = pilot.clips.find(c => c.id === item.id && c.status === 'complete' && c.text === item.text);
        if (sample) {
          const original = `${base}/voice-pilot-v1/${sample.filename}`;
          const bytes = (await readFile(mediaFile(root, original))).length;
          item.take = { original, generatedText: item.text, voiceId: state.voiceId, mediaType: 'audio', bytes, savedAt: new Date().toISOString(), video: null };
        } else item.take = await generateVoice(root, { text: item.text, voiceId: state.voiceId, seed: 42 });
        await persist();
      }
      await access(mediaFile(root, item.take.original));
      const analysis = await analyzeRecording(root, { id: item.id, text: item.text }, item.take, { reviewMedia: false });
      const artwork = resolveTimelineArtwork(analysis.timeline, library, core.id);
      const analysisUrl = `/coach/shared/analysis/${analysis.id}/analysis.json`;
      if (!artwork.requirements.length) analysis.timeline = artwork.timeline;
      await writeFile(mediaFile(root, analysisUrl), JSON.stringify(analysis, null, 2));
      const entry = { ...item.take, analysis: { id: analysis.id, url: analysisUrl, revision: analysis.revision }, mouthSync: mouthSync(analysis) };
      if (!artwork.requirements.length) {
        const timeline = validateTimeline(analysis.timeline, analysis.duration);
        entry.animation = { source: entry.original, analysisId: analysis.id, revision: analysis.revision, spokenText: item.text,
          automatic: true, createdAt: new Date().toISOString(), cues: timelineCues(timeline, analysis.envelope, analysis.duration), endingEmotion: timeline.at(-1).emotion };
      }
      let attached = false;
      await updateRecordings(root, saved => {
        if (saved[item.id]?.original && saved[item.id].original !== item.take.original) return;
        saved[item.id] = { ...saved[item.id], ...entry }; attached = true;
      });
      item.status = attached ? 'complete' : 'preserved'; item.duration = analysis.duration;
      item.missingArtwork = artwork.requirements.map(r => r.key); item.finishedAt = new Date().toISOString();
      await persist(); console.log(`DONE ${item.id} ${analysis.duration.toFixed(2)}s artworkMissing=${item.missingArtwork.length}`);
    } catch (error) { item.status = 'failed'; item.error = error.message; await persist(); console.error('FAILED', item.id, error.message); }
  }
  state.finishedAt = new Date().toISOString(); await persist();
  console.log(JSON.stringify({ complete: state.items.filter(i => i.status === 'complete').length, failed: state.items.filter(i => i.status === 'failed').map(i => ({ id: i.id, error: i.error })) }));
  if (state.items.some(i => i.status === 'failed')) process.exitCode = 1;
});
