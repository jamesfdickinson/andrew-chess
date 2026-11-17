import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { performanceCatalog, artworkPrompt, emotionDirections } from '../src/performance-catalog.js';
import { matchPerformance, generationCandidates, resolveTimelineArtwork } from '../src/performance-matching.js';
import { wordActing, suggestedWordSequences, sequenceLabel } from '../src/word-acting.js';
import { portraitPresets } from '../src/portrait-config.js';
import { validateTimeline } from '../src/animation-timeline.js';
import { generateFrameSet, queueFrameSets, readFrameSets, approveFrameSet, imageModel } from '../scripts/frame-sets.mjs';
import { recordingServer } from '../scripts/recording-server.mjs';
import { updateRecordings, readRecordings } from '../scripts/recording-store.mjs';
import { localVideoPath } from '../scripts/video-processing.mjs';

const key = 'arms-crossed-confident-subtle-talk';
const segment = (overrides = {}) => ({ start: 0, end: 2, emotion: 'determined', expression: 'Firm gaze', gesture: 'Crossing arms', speaking: true, confidence: .9, existingSet: 'encouraging', missingSet: null, reason: 'Firm delivery', ...overrides });
const plan = (segments = [segment()]) => ({ id: 'p', source: '/coach/shared/originals/a.webm', duration: 2, summary: 'Test', segments, frames: [], missingAssets: [] });
const candidate = { key, name: 'Arms crossed · confident', speaking: true };

test('every emotion has explicit facial acting before mouth articulation', () => {
  const emotions = [...new Set(performanceCatalog.map(entry => entry.emotion))];
  assert.equal(new Set(emotions.map(emotion => emotionDirections[emotion])).size, emotions.length);
  for (const entry of performanceCatalog) {
    assert.ok(emotionDirections[entry.emotion]);
    const prompt = artworkPrompt(entry);
    assert.ok(prompt.includes(emotionDirections[entry.emotion]));
    assert.match(prompt, /identity, NOT the expression to copy/);
    assert.ok(prompt.indexOf('TARGET FACIAL ACTING') < prompt.indexOf('Produce'));
  }
  assert.match(emotionDirections.curious, /unsmiling/);
  assert.match(emotionDirections.pleased, /half-lidded/);
  assert.match(emotionDirections.encouraging, /direct eye contact/);
});
test('new avatars need their own wording and video frame sets, with draft and approved progress', () => {
  const timeline = [{ start: 0, end: 1, emotion: 'smug' }, { start: 1, end: 2, emotion: 'pleased' }, { start: 2, end: 3, emotion: 'smug' }];
  const before = JSON.stringify(timeline), referenceId = 'abcdef123456';
  assert.equal(resolveTimelineArtwork(timeline).requirements.length, 0);
  const needed = resolveTimelineArtwork(timeline, [], referenceId);
  assert.equal(needed.requirements.length, 2);
  const first = needed.requirements[0];
  const asset = { key: `${first.key}-ref-${referenceId}`, performanceId: first.key, referenceId, status: 'draft', setId: `generated-${first.key}-ref-${referenceId}` };
  assert.equal(resolveTimelineArtwork(timeline, [asset], referenceId).requirements[0].status, 'draft');
  asset.status = 'approved';
  const resolved = resolveTimelineArtwork(timeline, [asset], referenceId);
  assert.equal(resolved.requirements.length, 1);
  assert.deepEqual(resolved.timeline.map(s => s.emotion), [asset.setId, 'pleased', asset.setId]);
  const old = { ...asset, referenceId: 'original', currentReference: false };
  assert.equal(resolveTimelineArtwork(timeline, [old], referenceId).requirements.length, 2);
  assert.equal(JSON.stringify(timeline), before);
  const video = plan([segment({ emotion: 'neutral', performanceId: 'portrait-neutral-subtle-talk', gesture: 'Still', existingSet: 'calm' })]);
  assert.equal(matchPerformance(video).missingAssets.length, 0);
  const missing = matchPerformance(video, [], { referenceId });
  assert.equal(missing.missingAssets[0].key, 'portrait-neutral-subtle-talk');
  assert.notEqual(missing.matchingRevision, matchPerformance(video).matchingRevision);
});
test('wording options are distinct timed sequences with explicit, bounded artwork requests', () => {
  const timeline = [{ start: 0, end: 2, text: 'Take their pawn!', emotion: 'calm', mouth: 'auto' }, { start: 2, end: 4, text: 'That is worth a smile.', emotion: 'calm', mouth: 'auto' }];
  const before = JSON.stringify(timeline);
  const options = suggestedWordSequences(timeline, { phraseId: 'idle-01' });
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map(option => option.label)).size, 3);
  for (const option of options) {
    assert.equal(option.label, sequenceLabel(option.timeline));
    assert.deepEqual(option.timeline.map(({ start, end }) => [start, end]), [[0, 2], [2, 4]]);
    assert.deepEqual(option.missingPerformanceIds, []);
  }
  assert.equal(JSON.stringify(timeline), before);
  assert.equal(sequenceLabel([{ emotion: 'smug' }, { emotion: 'smug' }, { emotion: 'pleased' }]), 'Smug → Pleased');
  const gestures = suggestedWordSequences([{ start: 0, end: 2, text: 'Maybe I shrug.', emotion: 'calm' }], { phraseId: 'idle-01' });
  assert.ok(gestures.some(option => option.missingPerformanceIds.length));
  for (const option of gestures) {
    assert.ok(option.missingPerformanceIds.length <= 2);
    for (const id of option.missingPerformanceIds) assert.ok(performanceCatalog.some(entry => entry.id === id && entry.speaking && !entry.assets.length));
  }
});
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-frames-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function until(read, done) {
  for (let i = 0; i < 200; i++) { const value = await read(); if (done(value)) return value; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Timed out waiting for test job.');
}

test('catalog normalizes reusable gestures, separates style and deduplicates missing sets', () => {
  assert.ok(performanceCatalog.length >= 50 && performanceCatalog.length <= 100);
  assert.equal(new Set(performanceCatalog.map(e => e.id)).size, performanceCatalog.length);
  for (const entry of performanceCatalog) for (const asset of entry.assets) {
    assert.ok(portraitPresets[asset]); assert.notEqual(asset, 'dgx-calm-pilot');
    assert.equal(!portraitPresets[asset].columns, entry.speaking);
  }
  const matched = matchPerformance(plan([segment({ end: 1 }), segment({ start: 1 })]));
  assert.equal(matched.missingAssets.length, 1); assert.equal(matched.missingAssets[0].key, key);
  assert.equal(generationCandidates(matched).length, 1);
  const calm = matchPerformance(plan([segment({ emotion: 'calm', expression: 'Neutral', gesture: 'Slight forward lean', existingSet: 'dgx-calm-pilot' })]));
  assert.equal(calm.segments[0].existingSet, 'calm'); assert.equal(calm.missingAssets.length, 0);
  const unsure = matchPerformance(plan([segment({ confidence: .2, missingSet: { name: 'Unsure', prompt: '', description: '' } })]));
  assert.equal(generationCandidates(unsure).length, 0);
});

test('wording supplies suitable variety without treating quiet speech as neutral', () => {
  const original = [{ start: 0, end: 2, text: 'That is worth a smile from your coach', emotion: 'calm', note: '', mouth: 'auto' }];
  const first = wordActing(original, { phraseId: 'idle-01' });
  const second = wordActing(original, { phraseId: 'idle-01', variation: 1 });
  assert.ok(['encouraging', 'pleased', 'delighted'].includes(first[0].emotion));
  assert.notEqual(first[0].emotion, second[0].emotion); assert.equal(original[0].emotion, 'calm');
  assert.equal(first[0].text, original[0].text); assert.equal(first[0].needsReview, true);
  assert.ok(['pawn-sad', 'disappointed', 'exasperated'].includes(wordActing([{ ...original[0], text: 'Our last pawn is gone!' }])[0].emotion));
});

test('generation claims survive duplicate requests; drafts require approval and become reusable', async t => {
  const root = await fixture(t); let calls = 0, finish;
  const options = { generate: async (_, request) => {
    calls++; await new Promise(resolve => { finish = resolve; });
    return { setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` };
  } };
  const results = await Promise.all([queueFrameSets(root, [candidate], options), queueFrameSets(root, [candidate], options)]);
  assert.equal(results.flat().length, 1);
  await until(async () => finish, Boolean); assert.equal(calls, 1);
  assert.equal((await readFrameSets(root))[0].status, 'generating');
  assert.equal(matchPerformance(plan(), await readFrameSets(root)).missingAssets[0].status, 'generating');
  await assert.rejects(approveFrameSet(root, key), /completed/);
  finish(); await until(() => readFrameSets(root), items => items[0].status === 'draft');
  assert.equal(matchPerformance(plan(), await readFrameSets(root)).segments[0].existingSet, 'encouraging');
  await approveFrameSet(root, key);
  const ready = matchPerformance(plan(), await readFrameSets(root));
  assert.equal(ready.missingAssets.length, 0); assert.equal(ready.segments[0].existingSet, `generated-${key}`);
  assert.equal(validateTimeline([{ start: 0, end: 2, emotion: `generated-${key}`, mouth: 'auto' }], 2).length, 1);
  await queueFrameSets(root, [candidate], options); assert.equal(calls, 1);
});

test('image API pins character and original style references, retains cost and redacts request preview', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'public/coach/jimmy/artwork'), { recursive: true });
  const image = await readFile(path.join(process.cwd(), 'public/coach/jimmy/artwork/jimmy-pawn-proud-sheet.png'));
  await writeFile(path.join(root, 'public/coach/jimmy/artwork/jimmy-pawn-proud-sheet.png'), image);
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=frame-test-secret\n');
  await mkdir(localVideoPath(root, `/coach/jimmy/frame-sets/${key}`), { recursive: true });
  let calls = 0;
  const result = await generateFrameSet(root, candidate, { fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://openrouter.ai/api/v1/images');
    const body = JSON.parse(options.body);
    assert.equal(body.model, imageModel); assert.equal(body.n, 1); assert.equal(body.aspect_ratio, '3:2');
    assert.equal(body.input_references.length, 2); assert.match(body.prompt, /Reference 2 defines the selected coach art style/); assert.match(body.prompt, /THREE equal columns/);
    return new Response(JSON.stringify({ data: [{ media_type: 'image/png', b64_json: image.toString('base64') }], usage: { cost: .03 } }));
  } });
  assert.equal(calls, 1); assert.equal(result.usage.cost, .03);
  const preview = await readFile(localVideoPath(root, `/coach/jimmy/frame-sets/${key}/request-preview.json`), 'utf8');
  assert.ok(!preview.includes('frame-test-secret')); assert.ok(!preview.includes('base64'));
  const sheet = await readFile(localVideoPath(root, result.image)); assert.equal(sheet.readUInt32BE(16), 960); assert.equal(sheet.readUInt32BE(20), 640);
  await assert.rejects(generateFrameSet(root, candidate, { fetcher: async () => { calls++; throw new Error('network'); } }), /No automatic retry/);
  assert.equal(calls, 2);
});

test('each trigger is capped at two new sets and failed claims are never automatically retried', async t => {
  const root = await fixture(t);
  const candidates = performanceCatalog.filter(entry => !entry.assets.length).slice(0, 3).map(entry => ({ key: entry.id, name: entry.label, speaking: entry.speaking }));
  let calls = 0;
  const options = { generate: async () => { calls++; throw new Error('Mock provider failed; inspect before retrying'); } };
  assert.equal((await queueFrameSets(root, candidates, options)).length, 2);
  await until(() => readFrameSets(root), items => items.length === 2 && items.every(item => item.status === 'failed'));
  await queueFrameSets(root, candidates.slice(0, 2), options);
  assert.equal(calls, 2);
});

test('artwork endpoints authenticate, reject stale takes and never generate on GET', async t => {
  const root = await fixture(t), id = 'out-of-pawns-02', raw = plan();
  await mkdir(localVideoPath(root, '/coach/shared/video-performance/p'), { recursive: true });
  await writeFile(localVideoPath(root, '/coach/shared/video-performance/p/plan.json'), JSON.stringify(raw));
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=fake\n');
  await updateRecordings(root, r => { r[id] = { original: raw.source, animation: { test: 'preserve' }, videoPerformance: { id: 'p', source: raw.source, url: '/coach/shared/video-performance/p/plan.json' } }; });
  let calls = 0;
  const handler = recordingServer(root, { videoPerformanceOptions: { imageOptions: { generate: async (_, request) => {
    calls++; return { image: `/coach/jimmy/frame-sets/${request.key}/sheet.png`, setId: `generated-${request.key}` };
  } } } });
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const get = () => fetch(`${base}/${id}/video-performance`).then(r => r.json());
  const post = (body, auth = token) => fetch(`${base}/${id}/create-frame-sets`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': auth }, body: JSON.stringify(body) });
  await get(); await get(); assert.equal(calls, 0);
  const body = { source: raw.source, planId: raw.id };
  assert.equal((await post(body, 'bad')).status, 403);
  assert.equal((await post({ ...body, source: '/coach/old.webm' })).status, 409);
  assert.equal((await post(body)).status, 202);
  await until(get, result => result.plan.missingAssets[0].status === 'draft');
  await post(body); assert.equal(calls, 1);
  assert.deepEqual((await readRecordings(root))[id].animation, { test: 'preserve' });
});
