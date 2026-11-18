import { coachConfig } from '../src/coach-config.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { moveContext, chooseReaction, chooseReview, reviewContext, createCoach } from '../src/coach.js';
import { chooseMove } from '../src/engine.js';

function context(fen, san) {
  const before = new Chess(fen);
  const game = new Chess(fen);
  const move = game.move(san);
  return moveContext(before, game, move);
}

test('coach detects an available pawn capture declined by the player', () => {
  const result = context('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e5');
  assert.equal(result.missedPawn, true);
  assert.equal(chooseReaction(result, () => 0).id, 'missed-pawn');
});
test('coach detects pawn capture and does not call it a missed pawn', () => {
  const result = context('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'exd5');
  assert.equal(result.missedPawn, false);
  assert.equal(chooseReaction(result).id, 'took-pawn');
});
test('en passant is a pawn opportunity', () => {
  const result = context('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'Kf2');
  assert.equal(result.missedPawn, true);
});
test('pinned pawn captures do not count as opportunities', () => {
  const result = context('k3r3/8/8/8/8/3p4/4P3/4K3 w - - 0 1', 'Kf1');
  assert.equal(result.missedPawn, false);
});
test('random actions and fallback are selectable', () => {
  const result = context('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e5');
  assert.equal(chooseReaction(result, () => 0).animation, 'point');
  assert.equal(chooseReaction(result, () => 0.99).animation, 'gesture');
  assert.equal(chooseReaction({ move: {} }), null);
});
test('a pawn taking a queen gets praise even when another pawn was available', () => {
  const result = context('4k3/8/8/3p1q2/4P3/8/8/4K3 w - - 0 1', 'exf5');
  assert.equal(chooseReaction(result).id, 'pawn-takes-piece');
  assert.match(chooseReaction(result, () => 0).text, /little pawn/);
});
for (const level of ['500', '1000', '1300']) {
  test(`${level} opponent returns a legal move without changing the game`, () => {
    const game = new Chess();
    game.move('e4');
    const fen = game.fen();
    const pgn = game.pgn();
    const move = chooseMove(game, level, () => 0.5);
    assert.equal(game.fen(), fen);
    assert.equal(game.pgn(), pgn);
    assert.ok(game.move(move));
  });
}
test('engine takes mate in one and returns nothing after game over', () => {
  const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  game.move(chooseMove(game, '1300', () => 0.5));
  assert.equal(game.isCheckmate(), true);
  assert.equal(chooseMove(game), null);
});
test('chess rules support castling and all four promotions', () => {
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  castle.move('O-O');
  assert.equal(castle.get('f1').type, 'r');
  const promotion = new Chess('7k/P7/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(promotion.moves({ verbose: true }).filter(move => move.promotion).length, 4);
});

 test('ordinary computer moves leave the coach silent', () => {
   const result = context('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1', 'Kf7');
   assert.equal(chooseReaction(result), null);
 });
 test('first matching event wins and the last event is the default', () => {
   const config = { events: [
     { id: 'skip', when: () => false, actions: [{ text: 'skip' }] },
     { id: 'first', when: () => true, actions: [{ text: 'one' }, { text: 'two' }] },
     { id: 'second', when: () => true, actions: [{ text: 'second' }] },
     { id: 'fallback', actions: [{ text: 'fallback' }] },
   ] };
   assert.equal(chooseReaction({}, () => 0.99, config).text, 'two');
   config.events[1].when = config.events[2].when = () => false;
   assert.equal(chooseReaction({}, () => 0, config).id, 'fallback');
 });

 test('review appears after a computer checkmate but not during play', () => {
   const game = new Chess();
   assert.equal(chooseReview(game), null);
   for (const san of ['f3', 'e5', 'g4', 'Qh4#']) game.move(san);
   const review = chooseReview(game);
   assert.equal(review.id, 'game-review');
   assert.equal(review.rating, 20);
   assert.match(review.text, /Not one/);
   game.undo();
   assert.equal(chooseReview(game), null);
 });
 test('pawn totals include en passant and exclude computer captures and undone moves', () => {
   const game = new Chess();
   for (const san of ['e4', 'a6', 'e5', 'd5', 'exd6', 'cxd6']) game.move(san);
   assert.equal(reviewContext(game).pawnsCaptured, 1);
   game.undo(); game.undo();
   assert.equal(reviewContext(game).pawnsCaptured, 0);
 });
 test('each additional pawn improves the review rating, other captures do not', () => {
   const before = new Chess().fen();
   let previous = -1;
   for (let count = 0; count <= 8; count++) {
     const history = Array.from({ length: count }, () => ({ color: 'w', captured: 'p', before }));
     const game = { isGameOver: () => true, history: () => history };
     const rating = chooseReview(game).rating;
     assert.ok(rating > previous);
     previous = rating;
     history.push({ color: 'w', captured: 'q', before });
     assert.equal(chooseReview(game).rating, rating);
   }
 });
 test('review calls out choosing a queen over a pawn with its move number', () => {
   const game = new Chess('4k3/8/8/3p1q2/4P3/8/8/4K3 w - - 0 1');
   game.move('exf5');
   const completed = { isGameOver: () => true, history: () => game.history({ verbose: true }) };
   assert.match(chooseReview(completed).text, /move 1, exf5: you chose a queen/);
 });

test('every idle phrase stays focused on pawns', () => {
  assert.ok(coachConfig.idle.length >= 10);
  for (const action of coachConfig.idle) assert.match(action.text, /pawn/i);
});

test('consecutive reactions choose a different action when alternatives exist', () => {
  const first = chooseReaction({ move: {}, check: true }, () => 0);
  const next = chooseReaction({ move: {}, check: true }, () => 0, coachConfig, first.actionId);
  assert.notEqual(first.actionId, next.actionId);
});
test('lost-pawn reaction happens immediately on their move and not again on ours', () => {
  const game = new Chess();
  for (const san of ['e4', 'd5', 'Nf3']) game.move(san);
  const before = new Chess(game.fen());
  const move = game.move('dxe4');
  const facts = moveContext(before, game, move);
  assert.equal(facts.lostPawn, true);
  assert.equal(chooseReaction(facts).id, 'lost-pawn');
  const nextBefore = new Chess(game.fen());
  const next = game.move('Ng1');
  const nextFacts = moveContext(nextBefore, game, next);
  assert.equal(nextFacts.lostPawn, false);
  assert.notEqual(chooseReaction(nextFacts)?.id, 'lost-pawn');
});
test('all recording actions have unique IDs and editable text/video fields', () => {
  const actions = [...coachConfig.twoMoveEvents.flatMap(event => event.actions), ...coachConfig.events.flatMap(event => event.actions), ...coachConfig.opponentEvents.flatMap(event => event.actions), ...coachConfig.idle, ...coachConfig.review.tiers.flatMap(tier => tier.actions)];
  assert.equal(new Set(actions.map(action => action.actionId)).size, actions.length);
  for (const action of actions) { assert.ok(action.text); assert.ok(Object.hasOwn(action, 'video')); }
});
test('placeholder speech speaks the chosen text and respects mute and stop', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spoken = [];
  let cancelled = 0;
  const oldSynthesis = globalThis.speechSynthesis;
  const oldUtterance = globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis = { speak: item => spoken.push(item), cancel: () => cancelled++ };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  t.after(() => { globalThis.speechSynthesis = oldSynthesis; globalThis.SpeechSynthesisUtterance = oldUtterance; });
  const classes = { add() {}, remove() {}, toggle() {} };
  const nodes = { '.coach-stage': { classList: classes }, video: { pause() {}, load() {}, removeAttribute() {} }, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes });
  coach.react({ move: {}, check: true });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, nodes['.speech'].textContent);
  coach.toggleMute();
  coach.react({ move: {}, check: true });
  assert.equal(spoken.length, 1);
  coach.toggleMute();
  coach.react({ move: {}, check: true });
  t.mock.timers.tick(2400);
  assert.equal(spoken.length, 2);
  coach.stop();
  assert.ok(cancelled >= 4);
});

function sequenceContext(fen, moves) {
  const game = new Chess(fen);
  let result;
  for (const san of moves) {
    const before = new Chess(game.fen());
    const move = game.move(san);
    result = moveContext(before, game, move);
  }
  return result;
}
for (const [label, fen, moves, expected] of [
  ['queen for pawn on opponent reply', '3r3k/8/8/3p4/8/8/8/K2Q4 w - - 0 1', ['Qxd5', 'Rxd5'], 'queen-for-pawn'],
  ['pawn for queen on opponent reply', '3r3k/8/8/3q4/4P3/8/P7/K7 w - - 0 1', ['exd5', 'Rxd5'], 'pawn-for-piece'],
  ['queen for pawn on player recapture', '7k/8/8/3p4/4Q3/8/8/K3R3 b - - 0 1', ['dxe4', 'Rxe4'], 'queen-for-pawn'],
  ['pawn for queen on player recapture', '7k/8/8/3q4/4P3/8/8/K3R3 b - - 0 1', ['Qxe4', 'Rxe4'], 'pawn-for-piece'],
  ['pawn for pawn', '7k/8/2p5/3p4/4P3/8/P7/K7 w - - 0 1', ['exd5', 'cxd5'], 'pawn-for-pawn'],
  ['freshly advanced pawn', '7k/3p4/8/4P3/8/8/8/K7 b - - 0 1', ['d5', 'exd6'], 'advanced-pawn-taken'],
]) {
  test(label, () => {
    const facts = sequenceContext(fen, moves);
    assert.equal(facts.recentMoves.length, 2);
    assert.equal(chooseReaction(facts).id, expected);
  });
}
test('unrelated consecutive captures are not a trade', () => {
  const facts = sequenceContext('7k/8/8/3p4/4Q3/8/p7/R6K w - - 0 1', ['Rxa2', 'dxe4']);
  assert.equal(facts.trade, null);
  assert.equal(facts.recapture, false);
});
test('one move does not invent a two-move trade', () => {
  const facts = sequenceContext('3r3k/8/8/3p4/8/8/8/K2Q4 w - - 0 1', ['Qxd5']);
  assert.equal(facts.trade, null);
  assert.equal(facts.previousMove, null);
});

test('saved studio recording is used automatically instead of placeholder speech', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let played = 0;
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { played++; return Promise.resolve(); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, { recordedVideo: action => `/coach/${action.actionId}-saved.webm` });
  coach.react({ move: {}, check: true });
  assert.equal(played, 1);
  assert.match(video.src, /^\/coach\/check-\d+-saved\.webm$/);
  coach.toggleMute();
  assert.equal(video.muted, true);
  coach.stop();
});

test('manual phrase preview replaces current speech and clears queued reactions', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { return Promise.resolve(); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, { recordedVideo: action => `/coach/${action.actionId}.webm` });
  coach.react({ move: {}, check: true });
  coach.react({ move: {}, check: true });
  coach.preview({ actionId: 'default-01', id: 'recording-preview', text: 'Saved test line', animation: 'talk' });
  assert.equal(video.src, '/coach/default-01.webm');
  assert.equal(nodes['.speech'].textContent, 'Saved test line');
  video.onended();
  assert.equal(video.src, '/coach/default-01.webm');
  coach.idleNow(); const first = video.src;
  coach.idleNow(); assert.notEqual(video.src, first);
  coach.stop();
});

test('approved studio timeline replaces placeholder caption and directs portrait playback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { return Promise.resolve(); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  let playedAction;
  const approved = { spokenText: 'An improvised line!', cues: [{ at: 0, emotion: 'smug', mouth: 1 }], endingEmotion: 'smug' };
  const portrait = { stop() {}, play(action) { playedAction = action; } };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, {
    recordedVideo: () => '/coach/shared/originals/actual.webm', recordedAnimation: () => approved, portrait,
  });
  coach.react({ move: {}, check: true });
  assert.equal(nodes['.speech'].textContent, approved.spokenText);
  assert.deepEqual(playedAction.animationCues, approved.cues);
  assert.equal(playedAction.endingEmotion, 'smug');
  coach.stop();
});

test('losing the last pawn overrides trade commentary and does not repeat', () => {
  const game = new Chess('3r3k/8/8/3q4/4P3/8/8/K7 w - - 0 1');
  game.move('exd5');
  const before = new Chess(game.fen());
  const move = game.move('Rxd5');
  const reaction = chooseReaction(moveContext(before, game, move));
  assert.equal(reaction.id, 'out-of-pawns');
  assert.match(reaction.actionId, /^out-of-pawns-/);
  const nextBefore = new Chess(game.fen());
  const next = game.move('Kb1');
  assert.notEqual(chooseReaction(moveContext(nextBefore, game, next))?.id, 'out-of-pawns');
});

test('promoting the last pawn does not count as losing it', () => {
  const facts = context('7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a8=Q+');
  assert.equal(facts.lostLastPawn, false);
  assert.notEqual(chooseReaction(facts).id, 'out-of-pawns');
});

test('coach warns after an opponent threatens a pawn without changing the board', () => {
  const game = new Chess('4k3/8/8/8/4P3/8/8/r3K3 b - - 0 1');
  const before = new Chess(game.fen());
  const move = game.move('Ra4');
  const fen = game.fen();
  const facts = moveContext(before, game, move);
  assert.deepEqual(facts.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(facts).id, 'pawn-under-attack');
  assert.equal(game.fen(), fen);
  assert.equal(game.history().length, 1);
});

test('coach warns when a quiet player move leaves a pawn exposed', () => {
  const facts = context('4k3/8/8/8/r3P3/8/8/4K3 w - - 0 1', 'Kf1');
  assert.deepEqual(facts.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(facts).id, 'pawn-in-danger');
});

test('pawn danger excludes pinned attackers and includes en passant', () => {
  const pinned = context('4k3/P3r3/8/8/8/8/8/K3R3 w - - 0 1', 'Kb1');
  assert.deepEqual(pinned.threatenedPawns, []);
  const enPassant = context('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', 'e4');
  assert.deepEqual(enPassant.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(enPassant).id, 'pawn-in-danger');
});

test('pawn danger warns for equal pawn trades but ignores defended captures by larger pieces', () => {
  const equal = context('7k/8/8/3p4/4P3/3P4/8/K7 w - - 0 1', 'Kb1');
  assert.deepEqual(equal.threatenedPawns, ['e4']);
  // Ignoring an available pawn capture still takes priority over danger advice.
  assert.equal(chooseReaction(equal)?.id, 'missed-pawn');
  const defended = context('7k/8/8/8/r3P3/3P4/8/K7 w - - 0 1', 'Kb1');
  assert.deepEqual(defended.threatenedPawns, []);
});

test('opponent threat warnings also ignore defended pawns without changing live history', () => {
  const game = new Chess('7k/8/8/8/4P3/3P4/r7/4K3 b - - 0 1');
  const before = new Chess(game.fen());
  const move = game.move('Ra4');
  const fen = game.fen();
  const facts = moveContext(before, game, move);
  assert.deepEqual(facts.threatenedPawns, []);
  assert.equal(chooseReaction(facts), null);
  assert.equal(game.fen(), fen);
  assert.deepEqual(game.history(), ['Ra4']);
});

test('a pinned defender cannot protect a pawn', () => {
  const facts = context('3r3k/8/8/8/r3P3/3P4/8/3K4 w - - 0 1', 'Kd2');
  assert.deepEqual(facts.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(facts)?.id, 'pawn-in-danger');
});

test('en passant warns whether the equal pawn recapture is available or not', () => {
  const defended = context('7k/8/8/8/3p4/8/3PP3/K7 w - - 0 1', 'e4');
  assert.deepEqual(defended.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(defended)?.id, 'pawn-in-danger');
  // A pawn guarding e4 does not guard e3, where the en passant attacker lands.
  const exposed = context('7k/8/8/8/3p4/3P4/4P3/K7 w - - 0 1', 'e4');
  assert.deepEqual(exposed.threatenedPawns, ['e4']);
});

test('opponent pawn threats warn even when a pawn-for-pawn recapture is available', () => {
  const facts = context('7k/8/3p4/8/4P3/3P4/8/K7 b - - 0 1', 'd5');
  assert.deepEqual(facts.threatenedPawns, ['e4']);
  assert.equal(chooseReaction(facts)?.id, 'pawn-under-attack');
});

test('coach completion waits for speech and releases on stop or mute', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spoken = [];
  t.mock.property(globalThis, 'speechSynthesis', { speak: item => spoken.push(item), cancel() {} });
  t.mock.property(globalThis, 'SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  const classes = { add() {}, remove() {}, toggle() {} };
  const nodes = { '.coach-stage': { classList: classes }, video: { pause() {}, load() {}, removeAttribute() {} }, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes });
  coach.react({ move: {}, check: true });
  let done = false;
  const waiting = coach.whenFinished().then(() => { done = true; });
  t.mock.timers.tick(2400);
  await Promise.resolve();
  assert.equal(done, false);
  spoken[0].onend();
  await waiting;
  assert.equal(done, true);
  coach.react({ move: {}, check: true });
  const stopped = coach.whenFinished();
  coach.stop();
  await stopped;
  coach.react({ move: {}, check: true });
  const muted = coach.whenFinished();
  coach.toggleMute();
  await muted;
});

test('coach completion waits for the full recorded video', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  const video = { pause() {}, load() {}, removeAttribute() {}, play: () => Promise.resolve() };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, { recordedVideo: () => '/coach/test.mp4' });
  coach.react({ move: {}, check: true });
  let done = false;
  const waiting = coach.whenFinished().then(() => { done = true; });
  t.mock.timers.tick(10000);
  await Promise.resolve();
  assert.equal(done, false);
  video.onended();
  await waiting;
  assert.equal(done, true);
});

test('coach queues reactions behind a recording and clears pending advice on reset', t => {
  t.mock.method(Math, 'random', () => 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  const played = [];
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { played.push(this.src); return Promise.resolve(); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, { recordedVideo: action => `/coach/${action.actionId}.mp4` });
  coach.react({ move: { captured: 'p' } });
  const firstEnd = video.onended;
  coach.react({ mover: 'b', move: {}, threatenedPawns: ['e4'] });
  coach.react({ mover: 'b', move: {}, lostLastPawn: true });
  assert.equal(played.length, 1);
  firstEnd();
  assert.equal(played.length, 2);
  assert.match(played[1], /pawn-under-attack/);
  firstEnd();
  assert.equal(played.length, 2);
  video.onended();
  assert.equal(played.length, 3);
  assert.match(played[2], /out-of-pawns/);
  coach.react({ move: {}, check: true });
  const oldEnd = video.onended;
  coach.reset();
  oldEnd();
  t.mock.timers.tick(2400);
  assert.equal(played.length, 3);
});

test('idle chatter waits a minute and never queues over advice', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = { add() {}, remove() {}, toggle() {} };
  let played = 0;
  const video = { pause() {}, load() {}, removeAttribute() {}, play() { played++; return Promise.resolve(); } };
  const nodes = { '.coach-stage': { classList: classes }, video, '.speech': {}, '.review-rating': {}, '.reaction-tag': {} };
  const coach = createCoach({ querySelector: key => nodes[key], classList: classes }, { recordedVideo: () => '/coach/test.mp4' });
  coach.startIdle(() => true);
  t.mock.timers.tick(59000);
  assert.equal(played, 0);
  t.mock.timers.tick(1000);
  assert.equal(played, 1);
  t.mock.timers.tick(60000);
  assert.equal(played, 1);
  video.onended();
  assert.equal(played, 1);
  t.mock.timers.tick(60000);
  assert.equal(played, 2);
  coach.stop();
});

for (const [fen, expected] of [
  ['7k/7p/8/8/3R4/8/8/K7 w - - 0 1', 'out-of-pawns'],
  ['7k/8/8/8/3R4/8/P7/K7 w - - 0 1', 'opponent-out-of-pawns'],
]) test(`pawnless reminders recur after eight plies: ${expected}`, () => {
  const game = new Chess(fen);
  const moves = ['Kb1', 'Kg8', 'Kb2', 'Kg7', 'Kc2', 'Kf7', 'Kc3', 'Kf6'];
  for (let i = 0; i < moves.length; i++) {
    const before = new Chess(game.fen());
    const move = game.move(moves[i]);
    const reaction = chooseReaction(moveContext(before, game, move), () => 0);
    if (i === 7) assert.equal(reaction?.id, expected);
    else assert.notEqual(reaction?.id, expected);
  }
  game.undo();
  const before = new Chess(game.fen());
  const move = game.move('Kf6');
  assert.equal(chooseReaction(moveContext(before, game, move), () => 0)?.id, expected);
});

test('pawnless reminders yield to move commentary and gestures', () => {
  for (const reminder of ['remindOutOfPawns', 'remindOpponentOutOfPawns']) {
    assert.equal(chooseReaction({ move: {}, check: true, [reminder]: true }, () => 0).id, 'check');
    assert.equal(chooseReaction({ mover: 'b', move: {}, lostPawn: true, [reminder]: true }, () => 0).id, 'lost-pawn');
    assert.equal(chooseReaction({ mover: 'b', move: {}, newPawnOpportunity: true, [reminder]: true }, () => 0).id, 'pawn-opportunity');
  }
});
