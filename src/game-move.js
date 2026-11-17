// Final boundary for player and worker moves, including stale worker replies.
export function applyLegalMove(game, requested) {
  if (!requested || game.isGameOver()) return null;
  const kings = game.board().flat().filter(piece => piece?.type === 'k');
  if (kings.filter(piece => piece.color === 'w').length !== 1 || kings.filter(piece => piece.color === 'b').length !== 1) return null;
  const legal = game.moves({ verbose: true }).find(move =>
    move.from === requested.from && move.to === requested.to &&
    move.promotion === requested.promotion && move.captured !== 'k');
  return legal ? game.move({ from: legal.from, to: legal.to, ...(legal.promotion ? { promotion: legal.promotion } : {}) }) : null;
}
