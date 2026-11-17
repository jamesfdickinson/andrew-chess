import test from 'node:test';
import assert from 'node:assert/strict';
import { portraitEmotion, portraitBeats, portraitDirection, portraitCue } from '../src/portrait-emotion.js';
import { portraitPresets, phraseAnimations } from '../src/portrait-config.js';
import { recordingPhrases } from '../src/recording-phrases.js';
test('portrait emotions preserve Andrew’s unusual pawn priorities', () => {
  assert.equal(portraitEmotion({ actionId: 'queen-for-pawn-01', text: 'They took our queen!' }), 'pawn-proud');
  assert.equal(portraitEmotion({ actionId: 'queen-over-pawn-01', text: 'A queen!' }), 'queen-no');
  assert.equal(portraitEmotion({ actionId: 'pawn-under-attack-01' }), 'concerned');
  assert.equal(portraitEmotion({ rating: 90 }), 'pleased');
  assert.equal(portraitEmotion({ rating: 20 }), 'skeptical');
  assert.equal(portraitEmotion({ emotion: 'calm', actionId: 'lost-pawn-01' }), 'calm');
});
test('every recorded phrase has valid expression and ending frames', () => {
  for (const phrase of recordingPhrases) {
    const config = phraseAnimations[phrase.id];
    assert.ok(config, phrase.id);
    assert.ok(portraitPresets[config.emotion], phrase.id);
    assert.ok(portraitPresets[config.endingEmotion], phrase.id);
  }
  assert.equal(new Set(Object.values(phraseAnimations).map(p => p.emotion)).size, 15);
});
test('recorded cues use playback seconds and hold until the next cue', () => {
  const direction = portraitDirection({ animationCues: [
    { at: 1.8, emotion: 'shocked', mouth: 2 }, { at: 0, emotion: 'calm', mouth: 0 },
    { at: -1, emotion: 'calm' }, { at: 2, mouth: 9 },
  ] });
  assert.equal(direction.cues.length, 2);
  assert.equal(portraitCue(direction.cues, 1.79).mouth, 0);
  assert.equal(portraitCue(direction.cues, 1.8).emotion, 'shocked');
  assert.equal(portraitCue(direction.cues, 5).mouth, 2);
});
test('approximate talking beats leave a pause between clauses', () => {
  const beats = portraitBeats('A queen? Take the pawn!');
  assert.equal(beats.length, 2);
  assert.ok(beats[1].end > beats[0].end + beats[0].pause);
  assert.equal(beats[0].pause, 320);
});
