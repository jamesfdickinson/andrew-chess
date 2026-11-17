import { fileURLToPath } from 'node:url';
import { analyzeRecording } from './analyze-recording.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';
import { mouthSync } from '../src/animation-timeline.js';
import { randomUUID } from 'node:crypto';
import { persistAnalysisJob } from './analysis-jobs.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv.slice(2);
const saved = await readRecordings(root);
for (const id of requested) if (!saved[id]?.original) throw new Error(`No recording for ${id}`);
for (const [id, recording] of Object.entries(saved)) {
  if (requested.length && !requested.includes(id)) continue;
  if (!recording.original || recording.analysis) { console.log(`${id}: existing analysis retained`); continue; }
  const phrase = recordingPhrases.find(item => item.id === id);
  if (!phrase) continue;
  const job = { id: randomUUID(), phraseId: id, source: recording.original, status: 'running', stage: 'Starting analysis', operation: 'analyze', pid: process.pid, startedAt: new Date().toISOString() };
  await persistAnalysisJob(root, job);
  try {
    const analysis = await analyzeRecording(root, phrase, recording, { id: job.id, progress: async stage => { console.log(`${id}: ${stage}`); job.stage = stage; await persistAnalysisJob(root, job); } });
    let attached = false;
    await updateRecordings(root, current => {
      if (current[id]?.original !== recording.original || current[id]?.analysis) return;
      current[id].analysis = { id: analysis.id, url: `/coach/shared/analysis/${analysis.id}/analysis.json`, revision: analysis.revision };
      current[id].mouthSync = mouthSync(analysis);
      attached = true;
    });
    console.log(JSON.stringify({ phrase: id, attached, seconds: analysis.duration, transcript: analysis.transcript.text, frames: analysis.frames.length, slices: analysis.slices.length }));
    job.status = attached ? 'complete' : 'superseded'; job.stage = attached ? 'Draft ready' : 'Take changed; results retained';
  } catch (error) { console.error(`${id}: ${error.message}`); process.exitCode = 1; job.status = 'failed'; job.stage = error.message; }
  await persistAnalysisJob(root, job);
}
