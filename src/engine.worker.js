import { Chess } from 'chess.js';
import { chooseMove } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const game = new Chess();
    game.loadPgn(data.pgn);
    self.postMessage({ move: chooseMove(game, data.level) });
  } catch (error) { self.postMessage({ error: error.message }); }
};
