import test from 'node:test';
import assert from 'node:assert/strict';
import { mouthSync } from '../src/animation-timeline.js';
import { recordedPerformance, recordedIdlePhrases } from '../src/recorded-performance.js';
import { portraitCue } from '../src/portrait-emotion.js';
import { createCoach } from '../src/coach.js';

test('audio timing works before approval, closes in silence, and never follows a retake', () => {
  const timing = mouthSync({ source: '/coach/take.webm', duration: .2, envelope: [{ at: 0, mouth: 0 }, { at: .05, mouth: 2 }, { at: .1, mouth: 2 }, { at: .15, mouth: 0 }] });
  const saved = { original: timing.source, video: '/coach/styled.mp4', mouthSync: timing };
  const performance = recordedPerformance(saved);
  assert.equal(performance.animation, null);
  assert.equal(performance.video, timing.source);
  assert.equal(portraitCue(performance.mouthCues, .06).mouth, 2);
  assert.equal(portraitCue(performance.mouthCues, .16).mouth, 0);
  assert.equal(portraitCue(performance.mouthCues, 10).mouth, 0);
  assert.deepEqual(recordedPerformance({ ...saved, original: '/coach/retake.webm' }).mouthCues, []);
});

test('face-click pool contains only recorded idle phrases', () => {
  const phrases = [{ id: 'out-of-pawns-01', event: 'out-of-pawns' }, { id: 'idle-01', event: 'idle' }, { id: 'idle-02', event: 'idle' }];
  assert.deepEqual(recordedIdlePhrases(phrases, { 'out-of-pawns-01': { original: 'event.webm' }, 'idle-02': { original: 'idle.webm' } }), [phrases[2]]);
});

test('recorded mouth cues use media time and are cleared for synthesized fallback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { currentTime: 0, pause() {}, load() {}, removeAttribute() {}, play: async () => {} };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const played = []; let clock;
  const cues = [{ at: 0, mouth: 0 }, { at: .1, mouth: 2 }];
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, {
    recordedVideo: () => '/coach/test.webm', recordedMouth: () => cues,
    portrait: { play: action => played.push(action), stop() {}, finish() {}, sync: value => { clock = value; } },
  });
  coach.preview({ actionId: 'idle-01', id: 'idle', text: 'A pawn.' });
  assert.deepEqual(played[0].mouthCues, cues);
  video.onplaying(); video.currentTime = .15;
  assert.equal(clock(), .15);
  video.onerror();
  assert.deepEqual(played.at(-1).mouthCues, []);
  coach.stop();
});
