import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { makeDraft, validateTimeline, frameAt, timelineCues } from '../src/animation-timeline.js';
import { audioEnvelope, analyzeRecording } from '../scripts/analyze-recording.mjs';
import { runFFmpeg, localVideoPath } from '../scripts/video-processing.mjs';
import { recordingServer } from '../scripts/recording-server.mjs';
import { updateRecordings, readRecordings } from '../scripts/recording-store.mjs';
import { zipFiles } from '../scripts/review-zip.mjs';

test('drafts use actual transcript and flag expression guesses; timeline validation rejects gaps and unknown poses', () => {
  const draft = makeDraft('out-of-pawns-01', 4, { words: [{ start: 0.2, end: 1, text: 'Improvised!', probability: 0.4 }] });
  assert.equal(draft[0].text, 'Improvised!'); assert.equal(draft[0].emotion, 'pawn-sad');
  assert.ok(draft.every(segment => segment.needsReview)); assert.match(draft[0].note, /Uncertain speech/);
  assert.equal(validateTimeline(draft, 4).length, 2);
  assert.throws(() => validateTimeline([{ ...draft[0], start: 0.2 }, draft[1]], 4), /join/);
  assert.throws(() => validateTimeline([{ ...draft[0], emotion: 'new-pose' }, draft[1]], 4), /Invalid animation/);
  assert.throws(() => validateTimeline(draft.slice(0, 1), 4), /full clip/);
});
test('audio amplitude closes mouths in silence and segment-relative gestures survive cue compaction', () => {
  const pcm = Buffer.alloc(3200); for (let i = 1600; i < 3200; i += 2) pcm.writeInt16LE(20000, i);
  const envelope = audioEnvelope(pcm);
  assert.deepEqual(envelope.map(item => item.mouth), [0, 2]);
  const timeline = [{ start: 0, end: 0.05, emotion: 'calm', mouth: 'auto' }, { start: 0.05, end: 0.1, emotion: 'nod', mouth: 'auto' }];
  assert.equal(frameAt(timeline, envelope, 0.06).emotion, 'nod');
  const cues = timelineCues(timeline, envelope, 0.1);
  assert.equal(cues.find(cue => cue.at === 0.05).segmentStart, 0.05);
  assert.equal(cues.at(-1).mouth, 0);
});
test('real extraction retains source, raw transcript, frames and synchronized media slices', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-analysis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public/coach/shared/originals'), { recursive: true });
  const original = '/coach/shared/originals/test.mp4';
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', localVideoPath(root, original)]);
  const raw = await readFile(localVideoPath(root, original));
  const result = await analyzeRecording(root, { id: 'out-of-pawns-01', text: 'Prompt' }, { original }, {
    recognize: async () => ({ text: 'Different line', words: [{ start: 0.1, end: 0.9, text: 'Different line', probability: 0.9 }] }),
    inferEmotion: async () => { assert.fail('Default wording workflow must not run the optional vocal-emotion model.'); },
  });
  assert.equal(result.transcript.text, 'Different line'); assert.equal(result.script, 'Prompt');
  assert.equal(result.emotions.status, 'not-requested');
  assert.match(result.timeline[0].note, /Wording-based comic acting/);
  assert.equal(result.frames.length, 2); assert.equal(result.slices.length, 1);
  assert.ok((await readFile(localVideoPath(root, result.slices[0].audio))).length > 1000);
  assert.deepEqual(await readFile(localVideoPath(root, original)), raw);
  assert.ok((await readdir(localVideoPath(root, `/coach/shared/analysis/${result.id}`))).includes('transcript.json'));
  const stages = [];
  const quick = await analyzeRecording(root, { id: 'out-of-pawns-01', text: 'Prompt' }, { original }, {
    reviewMedia: false,
    onPreviewReady: async reference => {
      const preview = JSON.parse(await readFile(localVideoPath(root, reference.url)));
      assert.equal(preview.source, original); assert.ok(preview.envelope.length); assert.equal(preview.previewOnly, true); stages.push('preview');
    },
    recognize: async () => { stages.push('transcript'); return { text: 'A lovely pawn', words: [] }; },
  });
  assert.deepEqual(stages, ['preview', 'transcript']);
  assert.deepEqual(quick.frames, []); assert.deepEqual(quick.slices, []);
});
test('analysis API authenticates writes, queues, preserves edits, approves spoken line, and rejects stale imports', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-analysis-api-'));
  const id = 'out-of-pawns-01', original = '/coach/shared/originals/test.mp4';
  await updateRecordings(root, current => { current[id] = { original }; });
  const middleware = recordingServer(root, { analysisOptions: {
    readiness: async () => ({ ready: true }),
    analyze: async (_, phrase, saved, { id: analysisId }) => {
      const result = { id: analysisId, revision: 'initial', source: saved.original, duration: 1, transcript: { text: 'My improvised line' }, envelope: [{ at: 0, mouth: 1 }], timeline: makeDraft(phrase.id, 1, { words: [] }) };
      await writeFile(localVideoPath(root, `/coach/shared/analysis/${analysisId}/analysis.json`), JSON.stringify(result)); return result;
    },
  } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const post = (op, data, auth = token) => fetch(`${base}/${id}/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': auth }, body: JSON.stringify(data) });
  assert.equal((await post('analyze', { source: original }, 'bad')).status, 403);
  assert.equal((await post('analyze', { source: '/old.mp4' })).status, 409);
  assert.equal((await post('analyze', { source: original })).status, 202);
  let result;
  for (let count = 0; count < 100; count++) {
    result = await (await fetch(`${base}/${id}/analysis`)).json();
    if (result.job.status === 'complete') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.job.status, 'complete');
  const activity = await (await fetch(`${base}/analysis-jobs`)).json();
  assert.equal(activity.jobs[0].phraseId, id);
  assert.equal(activity.jobs[0].status, 'complete');
  assert.ok((await readRecordings(root))[id].mouthSync.cues.length);
  const analysis = result.analysis;
  const body = { analysisId: analysis.id, revision: analysis.revision, source: original, timeline: analysis.timeline, spokenText: 'Corrected improvised line', approve: true };
  assert.equal((await post('timeline', body)).status, 400);
  body.timeline = body.timeline.map(segment => ({ ...segment, needsReview: false }));
  const approved = await post('timeline', body); assert.equal(approved.status, 200);
  const entry = (await readRecordings(root))[id];
  assert.equal(entry.animation.spokenText, 'Corrected improvised line');
  assert.ok(entry.animation.cues.length);
  assert.equal((await post('timeline', body)).status, 409);
  assert.equal(JSON.parse(await readFile(localVideoPath(root, `/coach/shared/analysis/${analysis.id}/analysis.json`))).revision, 'initial');
});
test('review ZIP contains a valid CRC and directory for independent export', () => {
  const zip = zipFiles([['test.txt', '123456789']]);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 14), 1);
});
