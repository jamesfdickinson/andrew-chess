import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { emotionSuggestion, emotionForRange, applyEmotionDraft, restoreDetectedEmotions } from '../src/emotion-analysis.js';
import { emotionWindows, addEmotionPass } from '../scripts/analyze-emotion.mjs';
import { recordingServer } from '../scripts/recording-server.mjs';
import { readRecordings, updateRecordings } from '../scripts/recording-store.mjs';
import { localVideoPath } from '../scripts/video-processing.mjs';

const evidence = (label, score = .9, margin = .8) => ({ start: 0, end: 3, status: 'estimated', label, score, margin, scores: { [label]: score } });
test('restore detected emotions replaces manual choices, recovers mixed timing and flags uncertain matches', () => {
  const timeline = [{ start: 0, end: 9, emotion: 'dgx-calm-pilot', mouth: 2, needsReview: false, text: 'My corrected words', note: 'Keep this direction' }];
  const emotions = { status: 'complete', segments: [evidence('angry'), { ...evidence('happy'), start: 3, end: 6 }, { ...evidence('sad', .4, .1), start: 6, end: 9 }] };
  const restored = restoreDetectedEmotions(timeline, emotions, 'pawn-sad');
  assert.deepEqual(restored.timeline.map(s => [s.start, s.end, s.emotion]), [[0, 3, 'stern'], [3, 6, 'delighted'], [6, 9, 'pawn-sad']]);
  assert.equal(restored.matched, 2); assert.equal(restored.fallback, 1);
  assert.ok(restored.timeline.every(s => s.mouth === 'auto' && s.needsReview && s.note === 'Keep this direction'));
  assert.equal(restored.timeline.map(s => s.text).join(''), 'My corrected words');
  assert.equal(timeline[0].emotion, 'dgx-calm-pilot');
  assert.deepEqual(restoreDetectedEmotions(restored.timeline, emotions, 'pawn-sad'), restored);
  assert.throws(() => restoreDetectedEmotions(timeline, { status: 'failed' }), /Analyze vocal emotion first/);
});
test('emotion mapping requires clear scores, keeps compatible acting, and requests missing talking assets', () => {
  assert.equal(emotionSuggestion(evidence('happy'), 'pawn-proud').suggestedEmotion, 'pawn-proud');
  assert.equal(emotionSuggestion(evidence('angry'), 'calm').suggestedEmotion, 'stern');
  assert.equal(emotionSuggestion(evidence('sad', .4, .1), 'calm').suggestedEmotion, null);
  assert.equal(emotionSuggestion(evidence('sad', .8, .05), 'calm').suggestedEmotion, null);
  assert.equal(emotionSuggestion(evidence('unknown')).suggestedEmotion, null);
  assert.equal(emotionSuggestion({ status: 'no_recognized_speech' }).suggestedEmotion, null);
  assert.match(emotionSuggestion(evidence('fearful')).missingAsset, /fearful talking/);
  assert.equal(emotionSuggestion(evidence('fearful')).suggestedEmotion, null);
  assert.equal(emotionSuggestion(evidence('disgusted')).needsReview, true);
});

test('bounded speech windows and suggestions preserve transcript warnings and distinguish unavailable emotion', () => {
  const windows = emotionWindows(7, { words: [{ start: .3, end: 1 }, { start: 3.5, end: 4 }] });
  assert.deepEqual(windows, [{ start: 0, end: 3, hasSpeech: true }, { start: 3, end: 6, hasSpeech: true }, { start: 6, end: 7, hasSpeech: false }]);
  const emotions = { status: 'complete', segments: [evidence('angry'), { ...evidence('happy'), start: 3, end: 6 }] };
  assert.equal(emotionForRange(emotions, 2.8, 5).label, 'happy');
  const timeline = [{ start: 0, end: 3, emotion: 'calm', mouth: 'auto', needsReview: false, note: 'Uncertain speech recognition. Expression comes from phrase configuration; video performance has not been interpreted.' }];
  const draft = applyEmotionDraft(timeline, emotions)[0];
  assert.equal(draft.emotion, 'stern'); assert.ok(draft.needsReview);
  assert.match(draft.note, /Uncertain speech/); assert.match(draft.note, /Voice suggests angry/);
  assert.doesNotMatch(draft.note, /comes from phrase/);
  assert.equal(timeline[0].emotion, 'calm');
  const failed = applyEmotionDraft(timeline, { status: 'failed' })[0];
  assert.equal(failed.emotion, 'calm'); assert.match(failed.note, /analysis failed/);
});

test('emotion-only pass retains approved timeline, corrected text and raw transcript', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-emotion-pass-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(localVideoPath(root, '/coach/shared/analysis/a'), { recursive: true });
  const analysis = { id: 'a', revision: 'old', source: '/coach/shared/originals/take.webm', audio: '/coach/shared/analysis/a/audio.wav',
    status: 'approved', duration: 3, spokenText: 'Corrected line', transcript: { text: 'Raw line', words: [] },
    timeline: [{ start: 0, end: 3, emotion: 'pawn-proud', mouth: 'auto', needsReview: false, note: 'My direction' }] };
  const result = await addEmotionPass(root, analysis, { inferEmotion: async () => ({ status: 'complete', segments: [evidence('sad')] }) });
  assert.notEqual(result.revision, analysis.revision); assert.equal(result.status, 'approved');
  assert.deepEqual(result.timeline, analysis.timeline); assert.deepEqual(result.transcript, analysis.transcript);
  assert.equal(result.spokenText, 'Corrected line'); assert.equal(result.emotions.segments[0].label, 'sad');
});

test('emotion API rejects stale/unauthorized requests and does not overwrite an edit made during inference', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'andrew-emotion-api-'));
  const id = 'out-of-pawns-01', source = '/coach/shared/originals/test.webm';
  const analysis = { id: 'a', revision: 'initial', source, audio: '/coach/shared/analysis/a/audio.wav', timeline: [], status: 'approved', spokenText: 'Keep this' };
  await mkdir(localVideoPath(root, '/coach/shared/analysis/a'), { recursive: true });
  await writeFile(localVideoPath(root, '/coach/shared/analysis/a/analysis.json'), JSON.stringify(analysis));
  const animation = { source, spokenText: 'Keep this', cues: [] };
  await updateRecordings(root, records => { records[id] = { original: source, analysis: { id: 'a', revision: 'initial', url: '/coach/shared/analysis/a/analysis.json' }, animation }; });
  let finish;
  const middleware = recordingServer(root, { analysisOptions: {
    emotionReadiness: async () => ({ ready: true }),
    emotions: async (_, prior) => new Promise(resolve => { finish = () => resolve({ ...prior, revision: 'emotion-result', emotions: { status: 'complete', segments: [evidence('sad')] } }); }),
  } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
  const { token } = await (await fetch(base)).json();
  const body = { source, analysisId: 'a', revision: 'initial' };
  const post = (data, auth = token) => fetch(`${base}/${id}/emotions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': auth }, body: JSON.stringify(data) });
  assert.equal((await post(body, 'bad')).status, 403);
  assert.equal((await post({ ...body, revision: 'stale' })).status, 409);
  assert.equal((await post(body)).status, 202);
  for (let i = 0; !finish && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await updateRecordings(root, records => { records[id].analysis.revision = 'user-edited'; });
  finish();
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(`${base}/${id}/analysis`)).json();
    if (state.job.status === 'superseded') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(state.job.status, 'superseded');
  const saved = (await readRecordings(root))[id];
  assert.equal(saved.analysis.revision, 'user-edited'); assert.deepEqual(saved.animation, animation);
  assert.equal(JSON.parse(await readFile(localVideoPath(root, '/coach/shared/analysis/a/revision-emotion-result.json'))).emotions.status, 'complete');
});
