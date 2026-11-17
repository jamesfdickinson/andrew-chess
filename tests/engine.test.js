import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseMove } from '../src/engine.js';

for (const level of ['1000', '1300']) {
  test(`${level} avoids trading a queen for a defended pawn even with a low random roll`, () => {
    const game = new Chess('3r3k/8/8/3p4/8/8/8/K2Q4 w - - 0 1');
    const fen = game.fen();
    const move = chooseMove(game, level, () => 0);
    assert.equal(game.fen(), fen);
    assert.notEqual(game.move(move).san, 'Qxd5');
  });

  test(`${level} takes mate instead of making a random mistake`, () => {
    const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    game.move(chooseMove(game, level, () => 0));
    assert.equal(game.isCheckmate(), true);
  });
}

test('an interrupted search restores the board and history and returns a legal move', t => {
  const game = new Chess();
  game.move('e4');
  const fen = game.fen();
  const pgn = game.pgn();
  let ticks = 0;
  t.mock.method(Date, 'now', () => ++ticks * 100);
  const move = chooseMove(game, '1300', () => 0.5);
  assert.equal(game.fen(), fen);
  assert.equal(game.pgn(), pgn);
  assert.ok(game.move(move));
});
