import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { mediaFile, rawMediaPlugin } from '../scripts/media-paths.mjs';

test('new coaches store production sources outside public and reject traversal', () => {
  const root = path.resolve('tmp/path-test');
  for (const folder of ['voice-reference', 'voice-pilot-v1', 'analysis', 'animated-voice-clips']) {
    assert.equal(mediaFile(root, `/coach/new-coach/${folder}/take.wav`), path.join(root, 'raw-media', 'coach', 'new-coach', folder, 'take.wav'));
  }
  assert.equal(mediaFile(root, '/coach/new-coach/audio/take.m4a'), path.join(root, 'public/coach/new-coach/audio/take.m4a'));
  for (const folder of ['voice', 'voice-fill-v3', 'originals']) assert.equal(mediaFile(root, `/coach/new-coach/${folder}/take.wav`), path.join(root, 'public', 'coach', 'new-coach', folder, 'take.wav'));
  assert.throws(() => mediaFile(root, '/coach/new-coach/voice/../../secret'));
});

test('studio media URLs stream relocated files with byte ranges', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'raw-media-server-'));
  const url = '/coach/new-coach/voice-reference/take/audio.wav';
  const file = mediaFile(root, url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '0123456789');
  const server = await createServer({ root, configFile: false, plugins: [rawMediaPlugin(root)], server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const full = await fetch(base + url);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), '0123456789');
  const range = await fetch(base + url, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');
});
