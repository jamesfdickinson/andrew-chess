import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { moveContext, chooseReaction } from '../src/coach.js';
import { applyLegalMove } from '../src/game-move.js';
function play(game, san) {
  const before = new Chess(game.fen());
  return moveContext(before, game, game.move(san));
}
test('new pawn attack praises pawn power but does not repeat on unrelated moves', () => {
  const game = new Chess('7k/8/3n4/8/4P3/8/8/K7 w - - 0 1');
  assert.equal(chooseReaction(play(game, 'e5')).id, 'pawn-threatens-piece');
  play(game, 'Kh7');
  const facts = play(game, 'Kb1');
  assert.equal(facts.pawnThreats.length, 0);
  assert.equal(chooseReaction(facts), null);
});
test('pinned pawn does not get praised for an illegal threat', () => {
  const game = new Chess('4r2k/8/8/3n4/4P3/8/8/4K3 w - - 0 1');
  assert.equal(play(game, 'e5').pawnThreats.length, 0);
});
test('quiet opening stays silent and check keeps a pawn-focused aside', () => {
  assert.equal(chooseReaction(play(new Chess('7k/8/8/8/8/8/4P3/KN6 w - - 0 1'), 'Na3')), null);
  const game = new Chess('7k/8/8/8/8/8/P7/K5R1 w - - 0 1');
  assert.equal(chooseReaction(play(game, 'Rh1+')).id, 'check');
});
test('early safe pawn setup gets its own commentary, but late advances do not', () => {
  assert.equal(chooseReaction(play(new Chess(), 'e4'), () => 0).id, 'pawn-setup');
  const late = new Chess('7k/8/8/8/8/8/4P3/K7 w - - 0 12');
  assert.equal(play(late, 'e4').earlyPawnSetup, false);
  const attack = new Chess('7k/8/3n4/8/4P3/8/8/K7 w - - 0 1');
  assert.equal(play(attack, 'e5').earlyPawnSetup, false);
  const danger = new Chess('7k/8/8/3p4/8/8/4P3/K7 w - - 0 1');
  assert.equal(play(danger, 'e4').earlyPawnSetup, false);
});
test('checkmate ends play with both kings on the board', () => {
  const game = new Chess();
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) game.move(san);
  const fen = game.fen();
  assert.equal(game.isCheckmate(), true);
  assert.equal(applyLegalMove(game, { from: 'h4', to: 'e1' }), null);
  assert.equal(applyLegalMove(game, { from: 'a2', to: 'a3' }), null);
  assert.equal(game.fen(), fen);
  assert.equal(game.board().flat().filter(p => p?.type === 'k').length, 2);
});
test('move boundary rejects king captures and moves that ignore check', () => {
  const invalid = new Chess('7k/8/8/8/8/8/P7/K6R w - - 0 1');
  assert.equal(applyLegalMove(invalid, { from: 'h1', to: 'h8' }), null);
  const game = new Chess('4r2k/8/8/8/8/8/P7/4K3 w - - 0 1');
  assert.equal(applyLegalMove(game, { from: 'a2', to: 'a3' }), null);
  assert.ok(applyLegalMove(game, { from: 'e1', to: 'd1' }));
});
test('legal play never removes either king', () => {
  let seed = 17;
  for (let run = 0; run < 8; run++) {
    const game = new Chess();
    for (let ply = 0; ply < 100 && !game.isGameOver(); ply++) {
      const moves = game.moves({ verbose: true });
      assert.ok(moves.every(move => move.captured !== 'k'));
      seed = (seed * 1664525 + 1013904223) >>> 0;
      assert.ok(applyLegalMove(game, moves[seed % moves.length]));
      assert.equal(game.board().flat().filter(p => p?.type === 'k').length, 2);
    }
  }
});
