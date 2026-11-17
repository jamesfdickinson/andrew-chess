// Worker-based opponent. chess.js owns all chess rules.
const values = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
export const levels = {
  500: { depth: 1, mistake: 0.45, noise: 150, time: 1800, tacticalDepth: 0 },
  1000: { depth: 3, mistake: 0, noise: 12, time: 1800, tacticalDepth: 3 },
  1300: { depth: 5, mistake: 0, noise: 0, time: 3500, tacticalDepth: 6 },
};

function evaluate(game) {
  let score = 0;
  for (const row of game.board()) for (const piece of row) {
    if (!piece) continue;
    const file = piece.square.charCodeAt(0) - 97;
    const rank = Number(piece.square[1]) - 1;
    const center = 3.5 - (Math.abs(3.5 - file) + Math.abs(3.5 - rank)) / 2;
    const development = piece.type === 'p' ? (piece.color === 'w' ? rank : 7 - rank) * 7 : center * 9;
    score += (piece.color === game.turn() ? 1 : -1) * (values[piece.type] + development);
  }
  return score;
}

function orderedMoves(game) {
  const priority = move => (values[move.captured] ?? 0) * 10
    - (move.captured ? values[move.piece] : 0) + (values[move.promotion] ?? 0);
  return game.moves({ verbose: true }).sort((a, b) =>
    priority(b) - priority(a));
}

const timeout = Symbol('search timeout');

// Finish exchanges before evaluating, so a defended piece isn't free material.
function quiescence(game, alpha, beta, deadline, remaining, ply) {
  if (Date.now() >= deadline) throw timeout;
  if (game.isCheckmate()) return -100000 + ply;
  if (game.isDraw()) return 0;
  if (!remaining) return evaluate(game);
  const inCheck = game.isCheck();
  if (!inCheck) {
    const score = evaluate(game);
    if (score >= beta) return score;
    alpha = Math.max(alpha, score);
  }
  for (const move of orderedMoves(game)) {
    if (!inCheck && !move.captured && !move.promotion) continue;
    game.move(move);
    let score;
    try { score = -quiescence(game, -beta, -alpha, deadline, remaining - 1, ply + 1); }
    finally { game.undo(); }
    if (score >= beta) return score;
    alpha = Math.max(alpha, score);
  }
  return alpha;
}

function search(game, depth, alpha, beta, deadline, tacticalDepth, ply) {
  if (Date.now() >= deadline) throw timeout;
  if (game.isCheckmate()) return -100000 + ply;
  if (game.isDraw()) return 0;
  if (!depth) return quiescence(game, alpha, beta, deadline, tacticalDepth, ply);
  let best = -Infinity;
  for (const move of orderedMoves(game)) {
    game.move(move);
    let score;
    try { score = -search(game, depth - 1, -beta, -alpha, deadline, tacticalDepth, ply + 1); }
    finally { game.undo(); }
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(game, level = '1000', random = Math.random) {
  if (game.isGameOver()) return null;
  const settings = levels[level] ?? levels[1000];
  const moves = orderedMoves(game);
  if (random() < settings.mistake) return moves[Math.floor(random() * moves.length)];
  const deadline = Date.now() + settings.time;
  let best = moves[0];
  const noise = new Map(moves.map(move => [move, random() * settings.noise]));
  // Only use fully completed depths; a timeout must not favor unsearched moves.
  for (let depth = 1; depth <= settings.depth; depth++) {
    let candidate = best;
    let bestScore = -Infinity;
    try {
      for (const move of moves) {
        game.move(move);
        let score;
        try { score = -search(game, depth - 1, -Infinity, Infinity, deadline, settings.tacticalDepth, 1); }
        finally { game.undo(); }
        score += noise.get(move);
        if (score > bestScore) { bestScore = score; candidate = move; }
      }
    } catch (error) {
      if (error !== timeout) throw error;
      break;
    }
    best = candidate;
    if (bestScore > 99000) break;
    moves.sort((a, b) => Number(b === best) - Number(a === best));
  }
  return { from: best.from, to: best.to, promotion: best.promotion };
}
