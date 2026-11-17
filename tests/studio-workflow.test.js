import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { recordingServer } from '../scripts/recording-server.mjs';
import { updateRecordings, readRecordings } from '../scripts/recording-store.mjs';
import { localVideoPath } from '../scripts/video-processing.mjs';
import { retainWordingDirection, matchPerformance } from '../src/performance-matching.js';
import { performanceTimeline } from '../src/video-performance.js';
import { readFrameSets } from '../scripts/frame-sets.mjs';

async function until(fn, done) {
  for (let n = 0; n < 200; n++) { const value = await fn(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Job did not finish');
}
async function setup(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-workflow-'));
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  const middleware = recordingServer(root, options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const post = (route, data) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': token }, body: JSON.stringify(data) });
  return { root, base, token, post };
}

async function seedReference(root, id = 'abcdef123456') {
  const directory = path.join(root, 'public/coach/jimmy/references', id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'reference.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), image: `/coach/references/${id}/reference.png` }));
  return id;
}

test('selected sequence queues every missing set once and rejects a changed coach reference', async t => {
  const requests = [];
  const { root, base, post } = await setup(t, { videoPerformanceOptions: { imageOptions: { generate: async (_, request) => {
    requests.push(request); return { setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` };
  } } } });
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-only\n');
  const referenceId = await seedReference(root);
  const performanceIds = ['portrait-neutral-subtle-talk', 'portrait-confident-subtle-talk', 'portrait-pleased-subtle-talk'];
  assert.equal((await post('frame-sets', { performanceIds, referenceId: 'original' })).status, 409);
  assert.equal(requests.length, 0);
  assert.equal((await post('frame-sets', { performanceIds: ['toString'], referenceId })).status, 400);
  assert.equal((await post('frame-sets', { performanceIds, referenceId })).status, 202);
  await until(() => readFrameSets(root), assets => assets.length === 3 && assets.every(a => a.status === 'draft'));
  assert.equal(requests.length, 3); assert.ok(requests.every(r => r.referenceId === referenceId));
  const again = await (await post('frame-sets', { performanceIds, referenceId })).json();
  assert.deepEqual(again.queued, []); assert.equal(requests.length, 3);
  const status = await (await fetch(`${base}/frame-sets`)).json();
  assert.ok(status.assets.every(asset => asset.currentReference && asset.status === 'draft'));
});

test('new recording prepares wording artwork for the new avatar when auto creation is enabled', async t => {
  let generated = 0;
  const id = 'out-of-pawns-01', source = '/coach/shared/originals/a.webm';
  const { root, post, base } = await setup(t, { analysisOptions: {
    readiness: async () => ({ ready: true }),
    imageOptions: { generate: async (_, request) => { generated++; return { setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` }; } },
    analyze: async (_, phrase, saved, { id: run }) => {
      const analysis = { id: run, revision: run, source: saved.original, duration: 1, phraseId: phrase.id, transcript: { text: 'Lovely pawn', words: [] }, envelope: [{ at: 0, mouth: 1 }], timeline: [{ start: 0, end: 1, emotion: 'pleased', mouth: 'auto', needsReview: true }] };
      await writeFile(localVideoPath(root, `/coach/shared/analysis/${run}/analysis.json`), JSON.stringify(analysis)); return analysis;
    },
  } });
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-only\n');
  await seedReference(root);
  await updateRecordings(root, recordings => { recordings[id] = { original: source }; });
  const get = () => fetch(`${base}/${id}/analysis`).then(r => r.json());
  await post(`${id}/analyze`, { source, useAutomatically: true, autoCreateArtwork: false });
  await until(get, result => result.job?.status === 'complete');
  assert.equal(generated, 0); assert.equal((await readRecordings(root))[id].animation, undefined);
  await post(`${id}/analyze`, { source, useAutomatically: true, autoCreateArtwork: true });
  const assets = await until(() => readFrameSets(root), result => result[0]?.status === 'draft');
  assert.equal(generated, 1); assert.equal(assets[0].performanceId, 'portrait-pleased-subtle-talk');
  assert.equal((await readRecordings(root))[id].animation, undefined);
  await until(get, result => result.job?.status === 'complete');
});

test('quick recording saves the original without waiting for legacy styling', async t => {
  let calls = 0;
  const { base, token, root } = await setup(t, { processor: async () => { calls++; throw new Error('Legacy styling must not run'); } });
  const response = await fetch(`${base}/out-of-pawns-01?originalOnly=1`, { method: 'POST', headers: { 'Content-Type': 'video/webm', 'X-Recording-Token': token }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(response.status, 200); assert.equal(calls, 0);
  const { recording } = await response.json();
  assert.equal(recording.processingError, null);
  assert.equal((await readRecordings(root))['out-of-pawns-01'].original, recording.original);
});

test('automatic animation is usable without review but never replaces a manually approved performance', async t => {
  const id = 'out-of-pawns-01', source = '/coach/shared/originals/a.webm';
  const { root, post } = await setup(t, { analysisOptions: {
    readiness: async () => ({ ready: true }),
    analyze: async (_, phrase, saved, { id: run }) => {
      const analysis = { id: run, revision: run, source: saved.original, duration: 1, phraseId: phrase.id, transcript: { text: 'A lovely pawn', words: [] },
        envelope: [{ at: 0, mouth: 1 }], timeline: [{ start: 0, end: 1, emotion: 'pleased', mouth: 'auto', needsReview: true }] };
      await writeFile(localVideoPath(root, `/coach/shared/analysis/${run}/analysis.json`), JSON.stringify(analysis)); return analysis;
    },
  } });
  await updateRecordings(root, r => { r[id] = { original: source }; });
  assert.equal((await post(`${id}/analyze`, { source, useAutomatically: true })).status, 202);
  let saved = await until(() => readRecordings(root), r => r[id]?.animation);
  assert.equal(saved[id].animation.automatic, true);
  assert.equal(saved[id].animation.spokenText, 'A lovely pawn');
  assert.equal(saved[id].animation.cues[0].emotion, 'pleased');
  const previous = saved[id].analysis.revision;
  const manual = { source, spokenText: 'My reviewed line', cues: [{ at: 0, emotion: 'stern', mouth: 0 }] };
  await updateRecordings(root, r => { r[id].animation = manual; });
  // Wait for the prior job to leave its running state before requesting a rerun.
  await new Promise(resolve => setTimeout(resolve, 30));
  await post(`${id}/analyze`, { source, useAutomatically: true });
  saved = await until(() => readRecordings(root), r => r[id].analysis.revision !== previous);
  assert.deepEqual(saved[id].animation, manual);
});

test('video gestures retain wording emotions at every wording boundary', () => {
  const analysis = { source: '/coach/a.webm', duration: 4, timeline: [{ start: 0, end: 2, emotion: 'smug' }, { start: 2, end: 4, emotion: 'pawn-sad' }] };
  const plan = { source: analysis.source, duration: 4, segments: [{ start: 0, end: 4, emotion: 'neutral', expression: 'Calm face', gesture: 'Arms crossed', speaking: true, confidence: .9, performanceId: 'arms-crossed-confident-subtle-talk', existingSet: 'calm', reason: 'Crossed arms', missingSet: null }] };
  const merged = retainWordingDirection(plan, analysis);
  assert.deepEqual(merged.segments.map(s => [s.start, s.end, s.emotion]), [[0, 2, 'confident'], [2, 4, 'sad']]);
  assert.deepEqual(merged.segments.map(s => s.observedEmotion), ['neutral', 'neutral']);
  const preview = performanceTimeline(matchPerformance(merged), analysis);
  assert.deepEqual(preview.map(s => s.emotion), ['smug', 'pawn-sad']);
  assert.equal(plan.segments[0].emotion, 'neutral');
});

test('batch queues each current clip once, runs sequentially and skips a replaced queued take before billing', async t => {
  let calls = 0, finish;
  const { root, base, post } = await setup(t, { videoPerformanceOptions: {
    readiness: async () => ({ ready: true }),
    analyze: async (_, analysis, { id, acting }) => {
      calls++; assert.equal(acting, 'gestures');
      await new Promise(resolve => { finish = resolve; });
      const plan = { id, source: analysis.source, duration: 1, segments: [], missingAssets: [], frames: [] };
      await mkdir(localVideoPath(root, `/coach/shared/video-performance/${id}`), { recursive: true });
      await writeFile(localVideoPath(root, `/coach/shared/video-performance/${id}/plan.json`), JSON.stringify(plan));
      return plan;
    },
  } });
  const ids = ['out-of-pawns-01', 'out-of-pawns-02'];
  for (const id of ids) {
    const source = `/coach/shared/originals/${id}.webm`, url = `/coach/shared/analysis/${id}/analysis.json`;
    await mkdir(localVideoPath(root, `/coach/shared/analysis/${id}`), { recursive: true });
    await writeFile(localVideoPath(root, url), JSON.stringify({ source, id, revision: 'r' }));
    await updateRecordings(root, r => { r[id] = { original: source, analysis: { url, revision: 'r' } }; });
  }
  const { candidates } = await (await fetch(`${base}/video-batch`)).json(); assert.equal(calls, 0);
  const first = await (await post('video-batch', { items: candidates, model: 'google/gemini-3.5-flash' })).json(); assert.equal(first.queued, 2);
  const duplicate = await (await post('video-batch', { items: candidates, model: 'google/gemini-3.5-flash' })).json(); assert.equal(duplicate.queued, 0);
  await until(async () => finish, Boolean); assert.equal(calls, 1);
  await updateRecordings(root, r => { r[ids[1]] = { original: '/coach/shared/originals/new.webm' }; });
  finish();
  await until(() => readRecordings(root), r => r[ids[0]].videoPerformance);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 1); assert.equal((await readRecordings(root))[ids[1]].videoPerformance, undefined);
});

test('manual artwork creation works without a recording, reuses its claim, and validates allowed options', async t => {
  let calls = 0;
  const { root, base, post } = await setup(t, { videoPerformanceOptions: { imageOptions: { generate: async (_, request) => {
    calls++; return { setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` };
  } } } });
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-only\n');
  assert.equal((await post('frame-sets', { performanceId: 'toString' })).status, 400);
  const data = { performanceId: 'chin-rest-curious-subtle-talk' };
  assert.equal((await post('frame-sets', data)).status, 202);
  const get = () => fetch(`${base}/frame-sets`).then(r => r.json());
  await until(get, result => result.assets[0]?.status === 'draft');
  await post('frame-sets', data); assert.equal(calls, 1);
  assert.equal((await post('frame-sets/approve', data)).status, 200);
  assert.equal((await get()).assets[0].status, 'approved');
  assert.deepEqual(await readRecordings(root), {});
});

test('uploading a core avatar versions future generation without reusing or overwriting old sets', async t => {
  const references = [];
  const { root, base, token, post } = await setup(t, { videoPerformanceOptions: { imageOptions: { generate: async (_, request) => {
    references.push(request.coreReference.id); return { setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` };
  } } } });
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-only\n');
  const data = { performanceId: 'chin-rest-sad-subtle-talk' };
  const get = () => fetch(`${base}/frame-sets`).then(r => r.json());
  await post('frame-sets', data); await until(get, result => result.assets[0]?.status === 'draft');
  const image = await readFile(path.join(process.cwd(), 'public/coach/jimmy/artwork/jimmy-pawn-proud-sheet.png'));
  const response = await fetch(`${base}/coach-reference`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Recording-Token': token }, body: image });
  assert.equal(response.status, 200);
  const { reference } = await response.json(); assert.notEqual(reference.id, 'original');
  await post('frame-sets', data);
  const state = await until(get, result => result.assets.length === 2 && result.assets.every(asset => asset.status === 'draft'));
  assert.deepEqual(references, ['original', reference.id]);
  assert.equal(state.assets.filter(asset => asset.currentReference).length, 1);
  assert.equal(new Set(state.assets.map(asset => asset.key)).size, 2);
  await post('frame-sets', data); assert.equal(references.length, 2);
});
