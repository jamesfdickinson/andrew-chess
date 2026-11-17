import { mediaFile } from '../scripts/media-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordingServer } from '../scripts/recording-server.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';

test('recording API saves, matches, resumes, preserves retakes, and rejects invalid writes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-recorder-test-'));
  const middleware = recordingServer(root, { trimmer: async (_, saved, start, end) => ({ ...saved, original: '/coach/shared/edits/test.mp4', trimSource: saved, trim: { start, end } }), processor: async (_, original) => {
    if (original.includes(recordingPhrases[3].id)) throw new Error('Test encoder failure');
    return { video: original.replace('/originals/', '/styled/'), style: { size: 200 } };
  } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initial = await (await fetch(`${base}/api/recordings`)).json();
  assert.deepEqual(initial.recordings, {});
  const id = recordingPhrases[0].id;
  const headers = { 'Content-Type': 'video/webm', 'X-Recording-Token': initial.token };
  const post = (phrase, options = {}) => fetch(`${base}/api/recordings/${phrase}`, { method: 'POST', headers, body: new Uint8Array([26, 69, 223, 163, 1]), ...options });
  assert.equal((await post(id, { headers: { 'Content-Type': 'video/webm' } })).status, 403);
  assert.equal((await post(id, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await post('not-a-phrase')).status, 400);
  assert.equal((await post(id, { headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post(id, { body: '' })).status, 400);
  const firstResponse = await post(id);
  assert.equal(firstResponse.status, 200);
  const first = (await firstResponse.json()).recording;
  assert.ok(first.original.startsWith(`/coach/shared/originals/${id}-`));
  const second = (await (await post(id)).json()).recording;
  assert.notEqual(first.video, second.video);
  const saved = await (await fetch(`${base}/api/recordings`)).json();
  assert.equal(saved.recordings[id].video, second.video);
  assert.equal((await readdir(path.join(root, 'public/coach/shared/originals'))).filter(file => file.endsWith('.webm')).length, 2);
  assert.equal((await readFile(mediaFile(root, first.original))).length, 5);
  const stored = JSON.parse(await readFile(path.join(root, 'public/coach/jimmy/recordings.json'), 'utf8'));
  assert.deepEqual(stored, saved.recordings);
  const trim = (body) => post(id + '/trim', { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await trim({ start: -1, end: 2, original: second.original })).status, 400);
  assert.equal((await trim({ start: 2, end: 1, original: second.original })).status, 400);
  assert.equal((await trim({ start: 0, end: 1, original: first.original })).status, 409);
  const edited = await trim({ start: 0.2, end: 0.8, original: second.original });
  assert.equal(edited.status, 200);
  const trimmed = (await edited.json()).recording;
  assert.deepEqual(trimmed.trim, { start: 0.2, end: 0.8 });
  assert.equal(trimmed.trimSource.original, second.original);
  assert.equal((await (await fetch(base + '/api/recordings')).json()).recordings[id].original, trimmed.original);
  // Concurrent saves must retain both mappings.
  await Promise.all([post(recordingPhrases[1].id), post(recordingPhrases[2].id)]);
  const concurrent = await (await fetch(`${base}/api/recordings`)).json();
  assert.equal(Object.keys(concurrent.recordings).length, 3);
  const failedStyle = await (await post(recordingPhrases[3].id)).json();
  assert.equal(failedStyle.recording.video, null);
  assert.match(failedStyle.recording.processingError, /Original saved/);
  assert.equal((await readFile(mediaFile(root, failedStyle.recording.original))).length, 5);
});

test('studio catalog covers every phrase without duplicate filenames', () => {
  assert.equal(recordingPhrases.length, 154);
  assert.equal(new Set(recordingPhrases.map(phrase => phrase.id)).size, recordingPhrases.length);
  for (const phrase of recordingPhrases) { assert.match(phrase.id, /^[a-z0-9-]+$/); assert.ok(phrase.text); }
});

test('recording origin must match the actual HTTP or HTTPS connection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-origin-test-'));
  try {
    const middleware = recordingServer(root);
    for (const hostHeader of ['host', ':authority']) {
    for (const [encrypted, origin, expected] of [
      [true, 'https://localhost:5177', 200],
      [true, 'http://localhost:5177', 403],
      [true, 'https://example.com', 403],
      [false, 'http://localhost:5177', 200],
      [false, 'https://localhost:5177', 403],
    ]) {
      let status;
      await middleware({ url: '/api/recordings', method: 'GET', socket: { encrypted }, headers: { [hostHeader]: 'localhost:5177', origin } }, {
        writeHead(code) { status = code; }, end() {},
      }, () => assert.fail('Recording request should be handled'));
      assert.equal(status, expected, `${encrypted ? 'HTTPS' : 'HTTP'} with ${origin}`);
    }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('HTTPS tunnel uploads work over local HTTP without trusting forwarded headers', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-tunnel-test-'));
  const origin = 'https://chess.example.test';
  const middleware = recordingServer(root, { tunnelOrigin: origin, processor: async () => ({ video: null }) });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const tunnelFetch = (url, { headers, method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const req = request(url, { headers, method }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
  for (const host of ['chess.example.test', 'localhost:5173']) {
    const headers = { host, origin };
    const response = await tunnelFetch(base + '/api/recordings', { headers });
    assert.equal(response.status, 200);
    const { token } = await response.json();
    const saved = await tunnelFetch(base + '/api/recordings/' + recordingPhrases[0].id, {
      method: 'POST', headers: { ...headers, 'content-type': 'video/webm', 'x-recording-token': token }, body: 'test recording'
    });
    assert.equal(saved.status, 200);
  }
  for (const headers of [
    { host: 'evil.example.test', origin },
    { host: 'chess.example.test', origin: 'https://evil.example.test' },
    { host: 'chess.example.test', origin: 'http://chess.example.test' },
    { host: 'localhost:5173', origin: 'https://evil.example.test', 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'https' },
  ]) assert.equal((await tunnelFetch(base + '/api/recordings', { headers })).status, 403);
  let code;
  await middleware({ url: '/api/recordings', method: 'GET', socket: { remoteAddress: '192.168.1.10' }, headers: { host: 'chess.example.test', origin } }, {
    writeHead(value) { code = value; }, end() {}
  }, () => assert.fail());
  assert.equal(code, 403);
});
