import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { prepareKeyframes, renderKeyframes, selectKeyframes, validateSelection } from '../scripts/keyframe-recording.mjs';
import { fluxWorkflow, ComfyClient } from '../scripts/comfy-keyframes.mjs';
import { recordingServer } from '../scripts/recording-server.mjs';
import { readRecordings, updateRecordings } from '../scripts/recording-store.mjs';
import { runFFmpeg, localVideoPath } from '../scripts/video-processing.mjs';

test('visual selection captures changes, covers the clip and bounds held poses', () => {
  const size = 8, fps = 8, raw = Buffer.alloc(24 * size * size);
  raw.fill(200, 5 * size * size, 12 * size * size);
  const candidates = selectKeyframes(raw, { size, fps, gap: .65 });
  const selected = candidates.filter(frame => frame.selected);
  assert.equal(selected[0].index, 0); assert.equal(selected.at(-1).index, 23);
  assert.ok(selected.some(frame => frame.index === 5));
  assert.ok(selected.slice(1).every((frame, i) => frame.at - selected[i].at <= .65));
  assert.deepEqual(validateSelection({ candidates }, [5, 0, 5]), [0, 5]);
  assert.throws(() => validateSelection({ candidates }, [5]), /first frame/);
  assert.throws(() => validateSelection({ candidates }, [0, 30]), /valid frames/);
});

test('real keyframe extraction/render retains raw media and voice with immutable versioned assets', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-keyframes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public/coach/shared/originals'), { recursive: true });
  const original = '/coach/shared/originals/test.mp4';
  await runFFmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', localVideoPath(root, original)]);
  await runFFmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=192x256', '-frames:v', '1', path.join(root, 'reference.png')]);
  const raw = await readFile(localVideoPath(root, original));
  const manifest = await prepareKeyframes(root, 'out-of-pawns-01', { original });
  assert.ok(manifest.selected.length >= 2); assert.ok(manifest.candidates.length > manifest.selected.length);
  let locked = false, released = false, calls = 0;
  const client = {
    lock: async () => { locked = true; return () => { released = true; }; },
    guard: async () => assert.ok(locked),
    upload: async (_, name) => name,
    generate: async (workflow, directory, stem) => {
      assert.ok(!released); calls++;
      assert.match(workflow['6'].inputs.image, /reference/);
      await copyFile(`${directory}/${stem}-source.png`, `${directory}/${stem}.png`);
    },
  };
  const result = await renderKeyframes(root, manifest, manifest.selected, { client, config: { reference: 'reference.png', size: 128, pixelSize: 32, seed: 1, steps: 4, prompt: 'test' } });
  assert.equal(calls, manifest.selected.length); assert.ok(released);
  assert.equal(result.source, original); assert.equal(result.frames[0].at, 0);
  assert.ok((await readFile(localVideoPath(root, result.video))).length > 1000);
  const audio = path.join(root, 'rendered-audio.pcm');
  await runFFmpeg(['-y', '-i', localVideoPath(root, result.video), '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', audio]);
  assert.ok(Math.abs((await readFile(audio)).length / 32000 - manifest.duration) < .1);
  assert.deepEqual(await readFile(localVideoPath(root, original)), raw);
});

test('keyframe API protects writes and never attaches an old result to a retake or replaces speech data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-keyframes-api-'));
  const id = 'out-of-pawns-01', original = '/coach/shared/originals/a.webm';
  const speech = { url: '/coach/shared/analysis/existing.json', revision: 'speech' }, animation = { source: original, cues: [] };
  await updateRecordings(root, records => { records[id] = { original, analysis: speech, animation }; });
  let complete;
  const middleware = recordingServer(root, { keyframeOptions: {
    prepare: async () => { await mkdir(localVideoPath(root, '/coach/shared/keyframes/test'), { recursive: true }); return { id: 'test', source: original, selected: [0], candidates: [{ index: 0, at: 0 }], renders: [] }; },
    render: async () => new Promise(resolve => { complete = () => resolve({ id: 'rendered', video: '/coach/shared/keyframes/test/render.mp4' }); }),
  } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const post = (op, body, auth = token) => fetch(`${base}/${id}/keyframes/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': auth }, body: JSON.stringify(body) });
  assert.equal((await post('prepare', { source: original }, 'invalid')).status, 403);
  assert.equal((await post('prepare', { source: '/old.webm' })).status, 409);
  assert.equal((await post('prepare', { source: original })).status, 202);
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(`${base}/${id}/keyframes`)).json();
    if (state.job.status === 'complete') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(state.job.status, 'complete');
  assert.deepEqual((await readRecordings(root))[id].analysis, speech);
  assert.deepEqual((await readRecordings(root))[id].animation, animation);
  const body = { source: original, manifestId: 'test', revision: state.manifest.revision, selected: [0] };
  assert.equal((await post('render', { ...body, revision: 'stale' })).status, 409);
  assert.equal((await post('render', body)).status, 202);
  for (let i = 0; !complete && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await updateRecordings(root, records => { records[id] = { original: '/coach/shared/originals/retake.webm' }; });
  complete();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual((await readRecordings(root))[id], { original: '/coach/shared/originals/retake.webm' });
});

test('Comfy refuses an occupied queue and workflow contains only local generation nodes', async () => {
  const client = new ComfyClient({}); client.json = async () => ({ queue_running: [['another-job']], queue_pending: [] });
  await assert.rejects(() => client.guard(), /another job/);
  const workflow = fluxWorkflow({ model: 'local', clip: 'local', vae: 'local', size: 512, seed: 1, steps: 4, prompt: 'test' }, 'style.png', 'performance.png', 'test');
  assert.equal(workflow['6'].inputs.image, 'style.png'); assert.equal(workflow['8'].inputs.image, 'performance.png');
  assert.equal(workflow['17'].inputs.steps, 4);
  assert.ok(Object.values(workflow).every(node => !/API|Cloud|ProImage/.test(node.class_type)));
});
