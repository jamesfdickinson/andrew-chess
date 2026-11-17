import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { addEmotionPass, emotionStatus } from './analyze-emotion.mjs';
import { localVideoPath } from './video-processing.mjs';
import { randomUUID } from 'node:crypto';
import { persistAnalysisJob } from './analysis-jobs.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv.slice(2);
if (!(await emotionStatus(root)).ready) throw new Error('Run npm run emotion:setup first.');
const recordings = await readRecordings(root);
for (const id of requested) if (!recordings[id]?.analysis) throw new Error(`Analyze ${id} first.`);
for (const [id, saved] of Object.entries(recordings)) {
  if (requested.length && !requested.includes(id) || !saved.analysis) continue;
  const analysis = JSON.parse(await readFile(localVideoPath(root, saved.analysis.url), 'utf8'));
  if (analysis.source !== saved.original || analysis.emotions?.status === 'complete') { console.log(`${id}: current emotion results retained or stale analysis skipped`); continue; }
  const job = { id: randomUUID(), phraseId: id, source: saved.original, status: 'running', stage: 'Starting vocal-emotion analysis', operation: 'emotions', pid: process.pid, startedAt: new Date().toISOString() };
  await persistAnalysisJob(root, job);
  try {
    const updated = await addEmotionPass(root, analysis, { progress: async stage => { console.log(stage); job.stage = stage; await persistAnalysisJob(root, job); } });
    const url = `/coach/shared/analysis/${analysis.id}/revision-${updated.revision}.json`;
    await writeFile(localVideoPath(root, url), JSON.stringify(updated, null, 2));
    let attached = false;
    await updateRecordings(root, current => {
      if (current[id]?.original !== saved.original || current[id]?.analysis?.revision !== analysis.revision) return;
      current[id].analysis = { id: analysis.id, url, revision: updated.revision }; attached = true;
    });
    console.log(JSON.stringify({ id, attached, device: updated.emotions.device, seconds: updated.emotions.elapsedSeconds, peakGpuMB: updated.emotions.peakGpuMB,
      suggestions: updated.emotions.segments.map(s => ({ start: s.start, label: s.label, score: +s.score.toFixed(3) })) }));
    job.status = attached ? 'complete' : 'superseded'; job.stage = attached ? 'Vocal-emotion suggestions ready' : 'Take changed; results retained';
  } catch (error) { console.error(`${id}: ${error.message}`); process.exitCode = 1; job.status = 'failed'; job.stage = error.message; }
  await persistAnalysisJob(root, job);
}
