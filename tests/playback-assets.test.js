import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { playbackAssets, playbackRecording, publicFile } from '../scripts/playback-assets.mjs';
import { recordedPerformance } from '../src/recorded-performance.js';
import { coachPath } from '../src/coach-paths.js';
import { registerGeneratedSets } from '../src/generated-sets.js';
import { portraitPresets } from '../src/portrait-config.js';

test('coach IDs match folder names and namespaced artwork registers', () => {
  assert.equal(coachPath('jimmy'), '/coach/jimmy');
  assert.equal(coachPath('andrew'), '/coach/andrew');
  assert.equal(coachPath('new-coach'), '/coach/new-coach');
  const asset = { key: 'layout-test', setId: 'generated-layout-test', status: 'approved', image: '/coach/andrew/frame-sets/layout-test/sheet.png' };
  try {
    registerGeneratedSets([asset]);
    assert.equal(portraitPresets[asset.setId].image, asset.image);
    registerGeneratedSets([{ ...asset, image: '/coach/andrew/../jimmy/frame-sets/layout-test/sheet.png' }]);
    assert.equal(portraitPresets[asset.setId].image, asset.image);
  } finally { delete portraitPresets[asset.setId]; }
});

test('audio replacement preserves timing but a retake cannot use stale audio or cues', () => {
  const saved = { original: '/coach/take.webm', audio: { source: '/coach/take.webm', url: '/coach/audio/take.m4a' },
    animation: { source: '/coach/take.webm', cues: [{ at: 0, mouth: 1 }] },
    mouthSync: { source: '/coach/take.webm', cues: [{ at: 0, mouth: 2 }] } };
  assert.equal(recordedPerformance(saved).video, saved.audio.url);
  const compact = playbackRecording(saved, saved.audio.url);
  assert.deepEqual(recordedPerformance(compact).mouthCues, saved.mouthSync.cues);
  assert.equal(recordedPerformance(compact).animation.source, saved.audio.url);
  const retake = recordedPerformance({ ...saved, original: '/coach/new.wav' });
  assert.equal(retake.video, '/coach/new.wav');
  assert.equal(retake.animation, null);
  assert.deepEqual(retake.mouthCues, []);
});

test('build emits only playback media, approved artwork and compact manifests', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'playback-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function put(url, value) {
    const file = publicFile(root, url);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  }
  const wav = Buffer.alloc(44 + 4800);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4800, 40);
  await put('/fonts/andrew-pixel.ttf', 'font');
  await put('/coach/jimmy/artwork.json', { base: '/coach/jimmy/artwork', sheets: { base: 'talk.png' } });
  await put('/coach/jimmy/artwork/talk.png', 'portrait');
  await put('/coach/coaches.json', [{ id: 'jimmy', name: 'Jimmy' }, { id: 'andrew', name: 'Andrew' }]);
  await put('/coach/andrew/originals/take.wav', wav);
  await put('/coach/andrew/recordings.json', { idle: { original: '/coach/andrew/originals/take.wav' } });
  await put('/coach/shared/originals/take.wav', wav);
  await put('/coach/jimmy/recordings.json', { idle: { original: '/coach/shared/originals/take.wav', history: ['/coach/old.mp4'], analysis: { url: '/coach/shared/analysis/private.json' } } });
  await put('/coach/jimmy/frame-sets.json', [{ status: 'approved', image: '/coach/jimmy/frame-sets/ok/sheet.png', key: 'ok' }, { status: 'pending', image: '/coach/not-needed.png' }]);
  await put('/coach/jimmy/frame-sets/ok/sheet.png', 'image');
  const assets = new Map();
  await playbackAssets(root).generateBundle.call({ emitFile: asset => assets.set(asset.fileName, asset.source) });
  const saved = JSON.parse(assets.get('coach/jimmy/recordings.json')).idle;
  assert.match(saved.original, /^\/coach\/jimmy\/audio\/.+\.m4a$/);
  assert.ok(assets.has(saved.original.slice(1)));
  const andrew = JSON.parse(assets.get('coach/andrew/recordings.json')).idle;
  assert.match(andrew.original, /^\/coach\/andrew\/audio\/.+\.m4a$/);
  assert.ok(assets.has(andrew.original.slice(1)));
  assert.ok(assets.has('fonts/andrew-pixel.ttf'));
  assert.ok(assets.has('coach/jimmy/artwork.json'));
  assert.ok(assets.has('coach/jimmy/artwork/talk.png'));
  assert.equal([...assets.keys()].some(url => url.startsWith('assets/') && url.endsWith('.png')), false);
  assert.ok(assets.has('coach/jimmy/frame-sets/ok/sheet.png'));
  assert.equal(saved.history, undefined);
  assert.equal(saved.analysis, undefined);
  assert.equal([...assets.keys()].some(url => /originals|analysis|\.mp4|not-needed/.test(url)), false);
  assert.throws(() => publicFile(root, '/../outside.wav'));
});
