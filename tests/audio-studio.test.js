import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { recordingServer } from '../scripts/recording-server.mjs';
import { FishSpeechClient } from '../scripts/fish-speech-client.mjs';
import { generateVoice } from '../scripts/coach-voice.mjs';
import { coachContext, coachId } from '../scripts/coach-profiles.mjs';
import { analyzeRecording } from '../scripts/analyze-recording.mjs';
import { trimRecording } from '../scripts/trim-recording.mjs';
import { localVideoPath } from '../scripts/video-processing.mjs';
import { replaceFile } from '../scripts/replace-file.mjs';

function wave(seconds = .2) {
  const samples = Math.floor(24000 * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(Math.sin(n / 10) * 3000), 44 + n * 2);
  return data;
}
async function until(fn, predicate) {
  for (let n = 0; n < 300; n++) { const data = await fn(); if (predicate(data)) return data; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Job did not complete.');
}
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'audio-studio-'));
  const middleware = recordingServer(root, options);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function session(id = 'jimmy') {
    const base = `${origin}/api/recordings`, suffix = `?coach=${id}`;
    const initial = await (await fetch(base + suffix)).json();
    const get = async route => (await fetch(base + (route ? '/' + route : '') + suffix)).json();
    const post = (route, data, mime = 'application/json') => fetch(base + '/' + route + suffix, { method: 'POST', headers: { 'X-Recording-Token': initial.token, 'Content-Type': mime }, body: mime === 'application/json' ? JSON.stringify(data) : data });
    return { get, post, token: initial.token };
  }
  return { root, origin, session, ...await session() };
}

test('game reads the published artwork manifest without scanning studio generation folders', async t => {
  const app = await setup(t);
  const directory = path.join(app.root, 'public/coach/jimmy');
  await mkdir(directory, { recursive: true });
  const approved = [{ key: 'published', status: 'approved', image: '/coach/jimmy/frame-sets/published/sheet.png' }];
  await writeFile(path.join(directory, 'frame-sets.json'), JSON.stringify(approved));
  const response = await fetch(`${app.origin}/coach/jimmy/frame-sets.json`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), approved);
});

test('native Fish client uses binary TTS, saved references, health/defaults and multipart upload without a model field', async () => {
  const calls = [];
  const client = new FishSpeechClient('http://192.168.1.84:8080/', { fetcher: async (url, options) => {
    calls.push({ url, ...options }); return url.endsWith('/v1/tts') ? new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } }) : Response.json({ status: 'ok' });
  } });
  assert.equal(client.generationTimeout, 600000);
  await client.health(); await client.defaults(); await client.listReferences();
  assert.ok(calls.every(call => call.headers.Accept === 'application/json'), 'Fish defaults to MessagePack without explicit JSON negotiation');
  const audio = await client.generate({ text: 'Hello pawn', referenceId: 'narrator', seed: 42 }); assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual(JSON.parse(calls[3].body), { text: 'Hello pawn', reference_id: 'narrator', format: 'wav', streaming: false, seed: 42 });
  assert.ok(!calls[3].headers.Authorization);
  await client.addReference({ id: 'narrator', text: 'My words', audio: new Blob([wave()], { type: 'audio/wav' }) });
  assert.ok(calls[4].body instanceof FormData); assert.equal(calls[4].body.get('id'), 'narrator'); assert.equal(calls[4].body.get('text'), 'My words');
  assert.equal(calls[4].headers.Accept, 'application/json');
  assert.equal(calls[4].headers['Content-Type'], undefined, 'fetch must supply the multipart boundary');
  await client.renameReference('narrator', 'speaker'); await client.deleteReference('speaker');
  assert.equal(calls[6].method, 'DELETE'); assert.deepEqual(JSON.parse(calls[6].body), { reference_id: 'speaker' });
  await assert.rejects(new FishSpeechClient('http://127.0.0.1:8080', { fetcher: async () => new Response('Loading model', { status: 503 }) }).generate({ text: 'Hi' }), /503.*Loading model/);
});

test('audio uploads, saved takes, and manifests are isolated by coach; stale and unauthorized writes fail', async t => {
  const app = await setup(t);
  const response = await app.post('coaches', { name: 'Morgan', voiceId: 'morgan' }); assert.equal(response.status, 200);
  const profile = (await response.json()).profile, second = await app.session(profile.id), id = 'out-of-pawns-01';
  assert.deepEqual((await second.get('')).recordings, {});
  const first = (await (await second.post(id, wave(), 'audio/wav')).json()).recording;
  assert.equal(first.mediaType, 'audio'); assert.ok(first.uploadedOriginal); assert.ok(first.original.endsWith('.wav'));
  const next = (await (await second.post(id, wave(.3), 'audio/wav')).json()).recording;
  assert.equal(next.takes[0].original, first.original);
  assert.deepEqual((await app.get('')).recordings, {});
  const unauthorized = await fetch(`${app.origin}/api/recordings/profile?coach=${profile.id}`, { method: 'POST', headers: { 'X-Recording-Token': app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Wrong' }) });
  assert.equal(unauthorized.status, 403);
  assert.equal((await second.post('takes/select', { phraseId: id, source: first.original, currentSource: 'stale' })).status, 400);
  assert.equal((await second.post('takes/select', { phraseId: id, source: first.original, currentSource: next.original })).status, 200);
  const published = await (await fetch(`${app.origin}/coach/coaches/${profile.id}/recordings.json`)).json();
  assert.equal(published[id].original, first.original); assert.equal(published[id].takes[0].original, next.original);
  const canonical = await (await fetch(`${app.origin}/coach/${profile.id}/recordings.json`)).json();
  assert.equal(canonical[id].original, first.original);
  assert.deepEqual(await (await fetch(`${app.origin}/coach/jimmy/recordings.json`)).json(), {});
  assert.equal((await fetch(`${app.origin}/coach/unknown-coach/recordings.json`)).status, 404);
  assert.equal((await second.post(id, Buffer.from('invalid audio'), 'audio/wav')).status, 500);
  assert.equal((await second.get('')).recordings[id].original, first.original);
});

test('new photos do not activate an identity; approving multiple core portraits versions the correct coach library', async t => {
  const calls = [];
  const app = await setup(t, { coachStudioOptions: { coreImage: async (root, uploads) => {
    calls.push({ coach: coachId(), uploads }); return { id: `candidate-${calls.length}`, image: `/coach/core-${calls.length}.png` };
  } }, videoPerformanceOptions: { imageOptions: { generate: async (_, request) => ({ setId: `generated-${request.key}`, image: `/coach/jimmy/frame-sets/${request.key}/sheet.png` }) } } });
  await writeFile(path.join(app.root, '.env.local'), 'OPENROUTER_API_KEY=test-only');
  const profile = (await (await app.post('coaches', { name: 'New coach' })).json()).profile, second = await app.session(profile.id);
  const image = await readFile(path.join(process.cwd(), 'public/coach/jimmy/artwork/jimmy-pawn-proud-sheet.png'));
  const upload = (await (await second.post('artwork/upload', image, 'image/png')).json()).upload;
  assert.equal((await second.get('artwork')).reference.pending, true);
  assert.equal((await second.get('frame-sets')).ready, false);
  await second.post('artwork/generate', { uploadIds: [upload.id], count: 2 });
  const art = await until(() => second.get('artwork'), data => data.jobs.at(-1)?.status === 'complete');
  const result = await (await second.post('artwork/approve', { ids: art.candidates.map(item => item.id) })).json();
  assert.equal(result.reference.images.length, 2); assert.ok(calls.every(item => item.coach === profile.id));
  await second.post('artwork/upload', image, 'image/png');
  assert.equal((await second.get('artwork')).reference.id, result.reference.id);
  assert.equal((await app.get('artwork')).reference.id, 'original');
  const option = 'portrait-neutral-subtle-talk';
  assert.equal((await second.post('frame-sets', { performanceId: option })).status, 202);
  const assets = await until(() => second.get('frame-sets'), data => data.assets[0]?.status === 'draft');
  assert.equal(assets.assets[0].coachId, profile.id); assert.deepEqual((await app.get('frame-sets')).assets, []);
});

test('voice queue serializes across coaches, keeps the pinned clone and preserves a take replaced during generation', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; });
  const calls = [];
  const app = await setup(t, { coachStudioOptions: { voiceReadiness: async () => ({ ready: true }), voice: async (_, request) => {
    calls.push({ ...request, coach: coachId() }); if (calls.length === 1) { entered(); await wait; }
    return { original: `/coach/generated-${calls.length}.wav`, generatedText: request.text, mediaType: 'audio', voiceId: request.voiceId };
  } }, analysisOptions: { analyze: async (_, phrase, saved, { id }) => ({ id, revision: id, source: saved.original, duration: .2, transcript: { text: saved.generatedText, words: [] }, envelope: [], timeline: [{ start: 0, end: .2, emotion: 'calm', mouth: 'auto' }] }) } });
  await app.post('profile', { name: 'Andrew', voiceId: 'original-voice' });
  const other = (await (await app.post('coaches', { name: 'Second', voiceId: 'second-voice' })).json()).profile, second = await app.session(other.id);
  const item = { id: 'out-of-pawns-01', text: 'A pawn!' };
  await app.post('voice/generate', { items: [item] }); await started;
  await second.post('voice/generate', { items: [item] });
  assert.equal(calls.length, 1);
  assert.equal((await (await app.post('voice/generate', { items: [item] })).json()).queued.length, 0);
  await app.post('profile', { name: 'Andrew', voiceId: 'changed-voice' });
  const manual = (await (await app.post(item.id, wave(), 'audio/wav')).json()).recording;
  release();
  await until(() => second.get('voice'), data => data.jobs[0]?.status === 'complete');
  assert.equal(calls[0].voiceId, 'original-voice'); assert.equal(calls[1].voiceId, 'second-voice'); assert.equal(calls[1].coach, other.id);
  const current = (await app.get('')).recordings[item.id]; assert.equal(current.original, manual.original); assert.equal(current.takes.length, 1);
  assert.equal((await app.get('voice')).jobs[0].status, 'superseded');
  await until(() => second.get('analysis-jobs'), data => data.jobs[0]?.status === 'complete');
});

test('real binary Fish output saves audio, lip sync needs no transcription, and trimming retains earlier takes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fish-audio-')); t.after(() => rm(root, { recursive: true, force: true }));
  const take = await coachContext.run('jimmy', () => generateVoice(root, { text: 'Lovely pawn.', voiceId: 'narrator' }, { fetcher: async () => new Response(wave(.5)) }));
  assert.equal(take.voiceId, 'narrator'); assert.equal((await readFile(localVideoPath(root, take.original))).toString('ascii', 0, 4), 'RIFF');
  const analysis = await analyzeRecording(root, { id: 'out-of-pawns-01', text: 'Lovely pawn.' }, take, { recognize: async () => { throw new Error('Should not transcribe generated text'); } });
  assert.equal(analysis.transcript.text, 'Lovely pawn.'); assert.ok(analysis.envelope.length); assert.deepEqual(analysis.frames, []);
  const trimmed = await trimRecording(root, { ...take, mouthSync: { source: take.original }, animation: { source: take.original } }, .1, .4);
  assert.ok(trimmed.original.endsWith('.m4a')); assert.equal(trimmed.takes[0].original, take.original); assert.equal(trimmed.mouthSync, undefined); assert.equal(trimmed.animation, undefined);
});

test('studio connects to a native Fish server, uploads a reference, generates binary audio and prepares timing without a browser', async t => {
  const calls = [];
  const fish = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ route: req.url, body: Buffer.concat(chunks).toString() });
    if (req.url === '/v1/tts') { res.setHeader('Content-Type', 'audio/wav'); res.end(wave(.3)); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/v1/references/list' ? { references: [{ id: 'narrator' }] } : { status: 'ok' })); }
  });
  await new Promise(resolve => fish.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fish.close(resolve)));
  const app = await setup(t);
  const configuration = await app.post('voice/config', { baseUrl: `http://127.0.0.1:${fish.address().port}` });
  assert.equal(configuration.status, 200); assert.equal((await configuration.json()).ready, true);
  const form = new FormData(); form.set('id', 'narrator'); form.set('text', 'Lovely pawn.'); form.set('audio', new Blob([wave()], { type: 'audio/wav' }), 'sample.wav');
  const upload = await fetch(`${app.origin}/api/recordings/voice/references/add`, { method: 'POST', headers: { 'X-Recording-Token': app.token }, body: form });
  assert.equal(upload.status, 200); assert.equal((await upload.json()).voiceId, 'narrator');
  assert.equal((await app.get('voice/references')).references[0].id, 'narrator');
  const response = await app.post('voice/generate', { items: [{ id: 'out-of-pawns-01', text: 'Lovely pawn.' }], useAutomatically: true });
  assert.equal(response.status, 202);
  await until(() => app.get('voice'), data => data.jobs[0]?.status === 'complete');
  await until(() => app.get('analysis-jobs'), data => data.jobs[0]?.status === 'complete');
  const saved = (await app.get('')).recordings['out-of-pawns-01'];
  assert.ok(saved.mouthSync.cues.length); assert.equal(saved.animation.spokenText, 'Lovely pawn.');
  assert.deepEqual(JSON.parse(calls.find(call => call.route === '/v1/tts').body), { text: 'Lovely pawn.', format: 'wav', streaming: false, reference_id: 'narrator' });
  const multipart = calls.find(call => call.route === '/v1/references/add').body;
  assert.match(multipart, /name="id"/); assert.match(multipart, /name="audio"; filename="sample.wav"/); assert.match(multipart, /name="text"/);
});

test('atomic status publication retries transient Windows reader locks without overwriting in place', async () => {
  let attempts = 0, delays = 0;
  await replaceFile('new.tmp', 'status.json', { move: async () => { if (++attempts < 3) throw Object.assign(new Error('Locked'), { code: 'EPERM' }); }, delay: async () => { delays++; } });
  assert.equal(attempts, 3); assert.equal(delays, 2);
  await assert.rejects(replaceFile('new.tmp', 'status.json', { move: async () => { throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); } }), /Missing/);
});
