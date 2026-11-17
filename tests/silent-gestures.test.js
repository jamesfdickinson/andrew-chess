import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createCoach, moveContext, chooseReaction } from '../src/coach.js';
import { recordingPhrases } from '../src/recording-phrases.js';
import { portraitPresets } from '../src/portrait-config.js';
import { coachConfig } from '../src/coach-config.js';

function fixture() {
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { throw new Error('Silent gesture played audio'); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': { textContent: 'Previous comment', classList: classes }, '.review-rating': {}, '.reaction-tag': {} };
  return { nodes, root: { querySelector: key => nodes[key], classList: classes } };
}
test('silent gesture skips recorded audio and speech, then releases the turn', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.999);
  let spoken = 0, lookups = 0;
  const oldSynthesis = globalThis.speechSynthesis, oldUtterance = globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis = { speak() { spoken++; }, cancel() {} };
  globalThis.SpeechSynthesisUtterance = class {};
  t.after(() => { globalThis.speechSynthesis = oldSynthesis; globalThis.SpeechSynthesisUtterance = oldUtterance; });
  const { nodes, root } = fixture();
  const coach = createCoach(root, { recordedVideo() { lookups++; return '/test.mp4'; } });
  coach.react({ move: { captured: 'p' } });
  assert.match(nodes['.speech'].textContent, /air/);
  assert.equal(spoken, 0); assert.equal(lookups, 0);
  let done = false;
  const wait = coach.whenFinished().then(() => { done = true; });
  t.mock.timers.tick(2300); await Promise.resolve(); assert.equal(done, false);
  t.mock.timers.tick(100); await wait; assert.equal(done, true);
  coach.stop();
});
test('quiet moves preserve the message and animate without holding the turn', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reactions = 0;
  const { nodes, root } = fixture(); const coach = createCoach(root, { portrait: { quiet() { reactions++; }, stop() {} } });
  coach.react({ mover: 'b', move: {} });
  assert.equal(nodes['.speech'].textContent, 'Previous comment');
  coach.react({ mover: 'w', move: {} });
  assert.equal(nodes['.speech'].textContent, 'Previous comment');
  assert.equal(reactions, 2);
  await coach.whenFinished();
  coach.stop();
});
test('silent gestures have registered closed-mouth frame sequences and are not recording tasks', () => {
  const actions = [...coachConfig.priorityEvents, ...coachConfig.events, ...coachConfig.opponentEvents].flatMap(event => event.actions).filter(a => a.kind === 'gesture');
  assert.ok(actions.length >= 6);
  for (const action of actions) {
    assert.ok(portraitPresets[action.emotion].columns);
    assert.ok(!recordingPhrases.some(p => p.id === action.actionId));
  }
});
test('opponent exposing a capturable pawn triggers silent anticipation', () => {
  const game = new Chess('7k/3p4/8/2B5/8/8/P7/K7 b - - 0 1');
  const before = new Chess(game.fen()); const move = game.move('d6');
  const reaction = chooseReaction(moveContext(before, game, move));
  assert.equal(reaction.id, 'pawn-opportunity');
  assert.equal(reaction.kind, 'gesture');
});
