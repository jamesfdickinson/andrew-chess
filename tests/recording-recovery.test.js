import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateRecordings, readRecordings } from '../scripts/recording-store.mjs';
import { persistAnalysisJob, listAnalysisJobs } from '../scripts/analysis-jobs.mjs';
const denied = async () => { throw Object.assign(new Error('Windows file replacement denied'), { code: 'EPERM' }); };

test('locked Windows index saves via journal and recovers an interrupted write', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'coach-journal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await updateRecordings(root, r => { r.first = { original: '/coach/first.webm' }; });
  await updateRecordings(root, r => { r.second = { original: '/coach/second.webm' }; }, { replace: denied });
  assert.equal(Object.keys(await readRecordings(root)).length, 2);
  await assert.rejects(updateRecordings(root, r => { r.third = { original: '/coach/third.webm' }; }, {
    replace: denied, overwrite: async file => { await writeFile(file, '{'); throw new Error('Interrupted'); },
  }), /Interrupted/);
  assert.equal(Object.keys(await readRecordings(root)).length, 3);
  await updateRecordings(root, r => { r.fourth = {}; }, { replace: denied });
  assert.equal(Object.keys(JSON.parse(await readFile(path.join(root, 'public/coach/jimmy/recordings.json'), 'utf8'))).length, 4);
});

test('studio activity retains current jobs across readers and ignores old takes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'coach-activity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recordings = { 'idle-01': { original: '/coach/new.webm' } };
  const job = { id: 'test-job', phraseId: 'idle-01', source: '/coach/new.webm', status: 'running', stage: 'Transcribing locally', pid: process.pid, startedAt: new Date().toISOString() };
  await persistAnalysisJob(root, job);
  assert.equal((await listAnalysisJobs(root, recordings))[0].stage, 'Transcribing locally');
  assert.deepEqual(await listAnalysisJobs(root, { 'idle-01': { original: '/coach/retake.webm' } }), []);
  await persistAnalysisJob(root, { ...job, status: 'failed', stage: 'Model failed' });
  assert.equal((await listAnalysisJobs(root, recordings))[0].status, 'failed');
});
