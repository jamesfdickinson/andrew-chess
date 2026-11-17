import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { performanceSchema, validatePerformance, performanceTimeline } from '../src/video-performance.js';
import { analyzeVideoPerformance, videoPerformanceStatus, preparePerformanceMedia, performanceRequestZip } from '../scripts/video-performance.mjs';
import { recordingServer } from '../scripts/recording-server.mjs';
import { readRecordings, updateRecordings } from '../scripts/recording-store.mjs';
import { runFFmpeg, localVideoPath } from '../scripts/video-processing.mjs';
import { sheetFiles } from '../src/animation-timeline.js';

const segment = overrides => ({ start: 0, end: 1, emotion: 'sad', expression: 'Furrowed brows', gesture: 'Still head', speaking: true, confidence: .85, existingSet: 'pawn-sad', reason: 'Similar disappointed expression', missingSet: null, ...overrides });
const result = overrides => ({ summary: 'Reuse sad talking frames.', spokenText: 'Oh no.', segments: [segment()], ...overrides });

test('provider schema stays simple while local validation enforces response constraints', () => {
  const schema = JSON.stringify(performanceSchema);
  assert.doesNotMatch(schema, /"(?:maxItems|minItems|minimum|maximum|enum|anyOf)":/);
  assert.throws(() => validatePerformance(result({ segments: [] }), 1), /1–96/);
  assert.throws(() => validatePerformance(result({ segments: Array.from({ length: 97 }, () => segment()) }), 1), /1–96/);
  for (const confidence of [-.1, 1.1]) assert.throws(() => validatePerformance(result({ segments: [segment({ confidence })] }), 1), /confidence/);
  assert.throws(() => validatePerformance(result({ segments: [segment({ existingSet: 'made-up' })] }), 1), /unknown frame set/);
  assert.equal(validatePerformance(result({ segments: [segment({ existingSet: null })] }), 1).segments[0].existingSet, null);
});

test('video plans validate timing and assets, avoid silent talking frames and keep approval separate', () => {
  const plan = { ...validatePerformance(result(), 1), source: '/coach/test.mp4', duration: 1 };
  const analysis = { source: plan.source, duration: 1, phraseId: 'out-of-pawns-02', transcript: { words: [] }, timeline: [{ emotion: 'calm' }], spokenText: 'My edited words' };
  const timeline = performanceTimeline(plan, analysis);
  assert.equal(timeline[0].emotion, 'pawn-sad'); assert.equal(timeline[0].mouth, 'auto'); assert.equal(timeline[0].needsReview, true);
  assert.equal(analysis.timeline[0].emotion, 'calm'); assert.equal(analysis.spokenText, 'My edited words');
  assert.throws(() => performanceTimeline({ ...plan, source: '/coach/old.mp4' }, analysis), /different take/);
  assert.throws(() => validatePerformance(result({ segments: [segment({ start: .2 })] }), 1), /timings/);
  assert.throws(() => validatePerformance(result({ segments: [segment({ existingSet: 'invented' })] }), 1), /unknown frame/);
  assert.throws(() => validatePerformance(result({ segments: [segment({ end: .5 })] }), 1), /full clip/);
  const silent = validatePerformance(result({ segments: [segment({ existingSet: 'headshake' })] }), 1);
  assert.equal(silent.segments[0].existingSet, null); assert.ok(silent.segments[0].missingSet);
  const uncertain = performanceTimeline({ ...plan, segments: [segment({ confidence: .2, existingSet: 'delighted' })] }, analysis);
  assert.notEqual(uncertain[0].emotion, 'delighted');
});

test('paid client prepares video with audio, sends structured catalog input once and exports missing artwork', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'coach-video-pass-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public/coach/shared/originals'), { recursive: true });
  await mkdir(path.join(root, 'public/coach/jimmy/artwork'), { recursive: true });
  await writeFile(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-key\n');
  const original = '/coach/shared/originals/test.mp4';
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', localVideoPath(root, original)]);
  for (const file of Object.values(sheetFiles)) await writeFile(path.join(root, 'public/coach/jimmy/artwork', file), await readFile(path.join(process.cwd(), 'public/coach/jimmy/artwork', file)));
  const status = await videoPerformanceStatus(root);
  assert.equal(status.ready, true); assert.equal('key' in status, false); assert.ok(!JSON.stringify(status).includes('test-key'));
  const analysis = { id: 'a', revision: 'r', phraseId: 'out-of-pawns-02', source: original, duration: 1, transcript: { text: 'Oh no.' } };
  let calls = 0;
  const missing = { name: 'Sad hand to cheek', description: 'Disappointed hand held against cheek', prompt: 'Draw the approved Andrew with hand to cheek and three aligned mouth frames.' };
  const plan = await analyzeVideoPerformance(root, analysis, { id: 'pass', fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_schema');
    assert.match(body.messages[0].content[1].video_url.url, /^data:video\/mp4;base64,/);
    assert.equal(body.messages[0].content.filter(c => c.type === 'image_url').length, Object.keys(sheetFiles).length - 1);
    assert.ok(!body.messages[0].content.some(c => c.text === 'Catalog sheet: dgxCalm'));
    return new Response(JSON.stringify({ model: body.model, usage: { cost: .01 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result({ segments: [segment({ missingSet: missing })] })) } }] }));
  } });
  assert.equal(calls, 1); assert.equal(plan.missingAssets.length, 1);
  assert.ok((await readFile(localVideoPath(root, plan.frames[0].image))).length > 100);
  // The prepared movie really retains an audio track.
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'raw-media/coach/shared/video-performance/pass/input.mp4'), '-map', '0:a:0', '-f', 'null', '-']);
  const zip = await performanceRequestZip(root, plan);
  assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.ok(zip.includes(Buffer.from('Sad hand to cheek')));
  const fileBefore = await readFile(localVideoPath(root, original)); assert.ok(fileBefore.length);
  await assert.rejects(analyzeVideoPerformance(root, analysis, { id: 'failed', prepareMedia: async () => ({ video: Buffer.from('test'), images: [] }), fetcher: async () => { calls++; throw new Error('network'); } }), /No automatic retry/);
  assert.equal(calls, 2);
  await assert.rejects(analyzeVideoPerformance(root, analysis, { id: 'rejected', prepareMedia: async () => ({ video: Buffer.from('test'), images: [] }), fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'Invalid request', metadata: { raw: JSON.stringify({ error: { message: 'Unsupported field test-key' } }) } } }), { status: 400 });
  } }), /Unsupported field \[redacted\]/);
  const failure = await readFile(path.join(root, 'raw-media/coach/shared/video-performance/rejected/error.json'), 'utf8');
  assert.ok(!failure.includes('test-key')); assert.equal(calls, 3);
});

test('video API is manual, authenticated, deduplicates active requests and preserves drafts and approved playback', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'coach-video-api-'));
  const id = 'out-of-pawns-02', source = '/coach/shared/originals/test.mp4';
  const analysis = { id: 'a', revision: 'r', source, duration: 1, phraseId: id, transcript: { text: 'Original words' }, timeline: [segment()] };
  await mkdir(localVideoPath(root, '/coach/shared/analysis/a'), { recursive: true });
  await writeFile(localVideoPath(root, '/coach/shared/analysis/a/analysis.json'), JSON.stringify(analysis));
  const animation = { source, spokenText: 'Approved words', cues: [] };
  await updateRecordings(root, r => { r[id] = { original: source, analysis: { id: 'a', revision: 'r', url: '/coach/shared/analysis/a/analysis.json' }, animation }; });
  let calls = 0, complete;
  const handler = recordingServer(root, { videoPerformanceOptions: {
    readiness: async () => ({ ready: true }),
    analyze: async (_, a, { id: planId }) => {
      calls++;
      await new Promise(resolve => { complete = resolve; });
      const plan = { ...result(), id: planId, source: a.source, duration: 1, missingAssets: [], frames: [] };
      await mkdir(localVideoPath(root, `/coach/shared/video-performance/${planId}`), { recursive: true });
      await writeFile(localVideoPath(root, `/coach/shared/video-performance/${planId}/plan.json`), JSON.stringify(plan));
      return plan;
    },
  } });
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { complete?.(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const get = () => fetch(`${base}/${id}/video-performance`).then(r => r.json());
  const body = { source, analysisId: 'a', revision: 'r', model: 'google/gemini-3.5-flash' };
  const post = (data = body, auth = token) => fetch(`${base}/${id}/analyze-video`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': auth }, body: JSON.stringify(data) });
  await get(); assert.equal(calls, 0);
  assert.equal((await post(body, 'wrong')).status, 403);
  assert.equal((await post({ ...body, source: '/coach/old.mp4' })).status, 409);
  assert.equal((await post({ ...body, model: 'arbitrary-model' })).status, 400);
  const first = await (await post()).json();
  const duplicate = await (await post()).json(); assert.equal(duplicate.job.id, first.job.id);
  for (let n = 0; !complete && n < 100; n++) await new Promise(r => setTimeout(r, 10));
  assert.equal(calls, 1); complete();
  let state;
  for (let n = 0; n < 100; n++) { state = await get(); if (state.job.status === 'complete') break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(state.job.status, 'complete'); assert.ok(state.plan);
  const saved = (await readRecordings(root))[id];
  assert.deepEqual(saved.animation, animation); assert.equal(saved.analysis.revision, 'r');
  assert.equal(JSON.parse(await readFile(localVideoPath(root, saved.analysis.url))).transcript.text, 'Original words');
  // A retake while a second request is running must never receive the old result.
  complete = null; await post();
  for (let n = 0; !complete && n < 100; n++) await new Promise(r => setTimeout(r, 10));
  await updateRecordings(root, r => { r[id] = { original: '/coach/retake.mp4' }; }); complete();
  for (let n = 0; n < 100; n++) { const jobs = await (await fetch(`${base}/analysis-jobs`)).json(); if (!jobs.jobs.length) break; await new Promise(r => setTimeout(r, 10)); }
  // Allow the asynchronous attachment attempt to finish before fixture cleanup.
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await readRecordings(root))[id].videoPerformance, undefined);
});
