import { setupInstall } from './pwa.js';
import { coachAsset, selectedCoach, setSelectedCoach, defaultCoachId } from './coach-session.js';
import { Chess } from 'chess.js';
import { applyLegalMove } from './game-move.js';
import { createCoach, moveContext } from './coach.js';
import './style.css';
import { attachCoachPortrait } from './coach-portrait.js';
import { recordingPhrases } from './recording-phrases.js';
import { recordedPerformance, recordedIdlePhrases } from './recorded-performance.js';
import { registerGeneratedSets } from './generated-sets.js';

const initialCoachName = selectedCoach() === 'jimmy' ? 'Jimmy' : 'Andrew';

// Small, grid-aligned silhouettes keep the pieces crisp at every board size.
const piecePaths = {
  p: 'M7 3h4v1h1v4h-1v1H7V8H6V4h1z M7 10h4v3h1v1h2v2H4v-2h2v-1h1z',
  r: 'M3 2h3v3h2V2h2v3h2V2h3v6h-2v5h1v1h1v2H3v-2h1v-1h1V8H3z',
  n: 'M8 2h5v2h1v2h1v8h1v2H3v-2h2v-2h2v-2h2V8H6v2H3V6h2V4h3z',
  b: 'M8 1h2v2h2v2h-2v2H8v2h2V7h3v3h-2v3h2v1h2v2H3v-2h2v-1h2v-3H5V5h1V3h2z',
  q: 'M1 3h2v3h2V2h2v4h1V0h2v6h1V2h2v4h2V3h2v4h-2v2h-2v2h-1v2h1v1h2v2H3v-2h2v-1h1v-2H5V9H3V7H1z',
  k: 'M8 0h2v2h3v2h-3v2H8V4H5V2h3z M4 7h10v2h-2v4h1v1h2v2H3v-2h2v-1h1V9H4z',
};
function pixelPiece(piece) {
  return `<svg class="piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}" viewBox="0 0 18 18" shape-rendering="crispEdges" aria-hidden="true"><path d="${piecePaths[piece.type]}"/>${piece.type === 'n' ? '<path class="piece-eye" d="M10 4h1v1h-1z"/>' : ''}${piece.type === 'q' ? '<path class="piece-detail" d="M5 8h8v1H5z M8 10h2v2H8z"/>' : ''}<path class="piece-detail" d="M5 14h8v1H5z"/></svg>`;
}
const names = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
document.querySelector('#app').innerHTML = `
<header><h1>Andrew Chess</h1><div class="header-actions"><button id="mute" aria-label="Mute coach audio" aria-pressed="false" title="Mute coach audio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/><path class="sound-waves" d="M16 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14"/><path class="sound-off" d="m16 9 6 6m0-6-6 6"/></svg></button><button id="install-button" hidden aria-label="Install Andrew Chess" title="Install Andrew Chess"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg></button><button id="menu-button" aria-label="Open menu" title="Open menu" aria-haspopup="dialog"><span class="menu-icon" aria-hidden="true"></span></button></div></header>
<main><section class="play-area" aria-label="Chess game">
<div class="player-row"><strong>COMPUTER</strong><span id="opponent-label">~1000</span><span id="thinking" role="status">YOUR TURN</span></div>
<div class="board-space"><div class="board-shell"><div id="board" class="board" role="group" aria-label="Chessboard. Select a piece, then a highlighted destination."></div></div></div>
</section><section class="coach-card" aria-label="Your chess coach">
<div class="coach-stage">            <svg class="pixel-andrew" viewBox="0 0 64 64" role="img" aria-label="Pixel Andrew wearing a green sweater" shape-rendering="crispEdges">
              <path d="M12 60h40v2H12zM18 62h28v2H18z" fill="#7d986a"/>
              <path fill="#273b2c" d="M15 44h34v16H15zM9 49h46v11H9z"/>
              <path fill="#508563" d="M19 43h26v17H19zM12 48h7v12h-7zM45 48h7v12h-7z"/>
              <path fill="#e9ac7b" d="M26 37h12v11H26zM18 17h28v20H18zM22 37h20v5H22zM14 24h4v9h-4zM46 24h4v9h-4z"/>
              <path fill="#f4c393" d="M21 19h22v15H21zM25 34h15v5H25z"/>
              <path fill="#493a2f" d="M18 12h28v7H18zM22 8h19v5H22zM15 16h7v10h-7zM42 17h7v9h-7zM22 14h9v7h-9z"/>
              <path fill="#263c34" d="M21 25h10v7H21zM34 25h10v7H34zM31 27h3v2h-3z"/>
              <path fill="#d9e6c0" d="M23 27h5v3h-5zM36 27h5v3h-5z"/>
              <path fill="#9c583f" d="M29 35h9v2h-9z"/><path fill="#a8c38a" d="M28 49h8v3h-8zM30 46h4v10h-4z"/>
              <g class="pixel-hand"><path fill="#e9ac7b" d="M47 40h7v10h-7zM50 35h4v8h-4z"/><path fill="#508563" d="M45 49h10v8H45z"/></g>
            </svg><audio preload="metadata" aria-label="Coach speech"></audio><span class="reaction-tag">standing by</span><button class="coach-test" aria-label="Hear another idle phrase"></button><span class="coach-caption">Coach ${initialCoachName}</span></div><div class="coach-copy">
<p class="review-rating" aria-live="polite" hidden></p><p class="speech" aria-live="polite">Hi, I'm ${initialCoachName}. Make your first move!</p></div>
</section></main>
<dialog id="menu-dialog"><h2>MENU</h2><div class="menu-options"><label>Coach<select id="game-coach"></select></label><a id="open-studio" href="/studio.html" target="_blank" rel="noopener">Coach studio</a><button id="new-game">New game</button><button id="learning">Learning: take pawns <small>Coming soon</small></button><button id="close-menu">Back to game</button></div></dialog>
<dialog id="new-game-dialog"><h2>NEW GAME</h2><form id="new-game-form"><label for="level">Choose your level</label><select id="level"><option value="500">500 · Easygoing</option><option value="1000" selected>1000 · Casual</option><option value="1300">1300 · A little spicy</option></select><div class="dialog-actions"><button type="button" id="cancel-new-game">Cancel</button><button type="submit">Start game</button></div></form></dialog>
<dialog id="learning-dialog"><h2>LEARNING</h2><p>Learn to take pawns with Andrew.</p><p>This lesson is coming soon.</p><button id="close-learning">Back to menu</button></dialog>
<dialog id="promotion"><h2>Choose your promotion</h2><div>${['q', 'r', 'b', 'n'].map(piece => `<button data-promotion="${piece}" aria-label="Promote to ${names[piece]}">${pixelPiece({ color: 'w', type: piece })}</button>`).join('')}</div></dialog>
`;

setupInstall();

const $ = selector => document.querySelector(selector);
// Quantize every square to whole 2px cells instead of stretching the sprites.
const boardSpace = $('.board-space');
new ResizeObserver(() => {
  const available = Math.min(boardSpace.clientWidth - 16, boardSpace.clientHeight - 22, 592);
  const cell = Math.max(32, Math.floor((available - 16) / 16) * 2);
  $('.board-shell').style.setProperty('--board-size', `${cell * 8 + 16}px`);
}).observe(boardSpace);
const game = new Chess();
let recordings = {}, coachProfiles = [], coachArtwork = [], coachReference = null;
async function refreshRecordings() {
  const requestedCoach = selectedCoach();
  const read = async (name, fallback) => {
    try { const response = await fetch(`/coach/${requestedCoach}/${name}`, { cache: 'no-store' }); return response.ok ? await response.json() : fallback; } catch { return fallback; }
  };
  const [nextArtwork, reference, nextRecordings] = await Promise.all([
    read('frame-sets.json', []),
    read('references/active.json', coachProfiles.find(item => item.id === requestedCoach)?.reference || null),
    read('recordings.json', {}),
  ]);
  if (requestedCoach !== selectedCoach()) return;
  registerGeneratedSets(nextArtwork);
  coachArtwork = nextArtwork; recordings = nextRecordings; coachReference = reference;
  portrait.refresh();
}
refreshRecordings().then(() => portrait.refresh());
window.addEventListener('focus', refreshRecordings);
const portrait = attachCoachPortrait($('.coach-card'), { getCoach: () => ({ id: selectedCoach(), reference: coachReference, assets: coachArtwork }) });
const coach = createCoach($('.coach-card'), {
  recordedVideo: action => {
    return recordedPerformance(recordings[action.actionId]).video;
  },
  recordedAnimation: action => {
    return recordedPerformance(recordings[action.actionId]).animation;
  },
  recordedMouth: action => recordedPerformance(recordings[action.actionId]).mouthCues,
  portrait,
  getName: () => coachProfiles.find(item => item.id === selectedCoach())?.name || initialCoachName,
});
async function loadCoaches() {
  try { const response = await fetch('/coach/coaches.json', { cache: 'no-store' }); if (response.ok) coachProfiles = await response.json(); } catch {}
  if (!coachProfiles.length) coachProfiles = [{ id: defaultCoachId, name: 'Andrew' }, { id: 'jimmy', name: 'Jimmy' }];
  $('#game-coach').replaceChildren(...coachProfiles.map(item => new Option(item.name, item.id))); $('#game-coach').value = selectedCoach();
  const name = coachProfiles.find(item => item.id === selectedCoach())?.name || initialCoachName;
  $('.coach-caption').textContent = 'Coach ' + name;
  if ($('.reaction-tag').textContent === 'standing by') $('.speech').textContent = `Hi, I'm ${name}. Look for pawns you can take!`;
  $('#open-studio').href = `/studio.html?coach=${encodeURIComponent(selectedCoach())}`;
}
loadCoaches();
$('#game-coach').onchange = async () => {
  coach.stop(); recordings = {}; coachArtwork = []; coachReference = null;
  setSelectedCoach($('#game-coach').value);
  const url = new URL(location.href); url.searchParams.set('coach', selectedCoach()); history.replaceState(null, '', url);
  await loadCoaches(); await refreshRecordings(); portrait.refresh(); coach.reset();
};
window.addEventListener('focus', () => loadCoaches());
let selected = null;
let level = '1000';
let worker;
let thinking = false;
let replyTimer;
let opponentGeneration = 0;
let pendingPromotion;
let lastContext;
let lastTestId;

$('.coach-test').onclick = async () => {
  if (thinking || pendingPromotion) return;
  $('.coach-test').disabled = true;
  await refreshRecordings();
  if (thinking || pendingPromotion) { render(); return; }
  const saved = recordedIdlePhrases(recordingPhrases, recordings);
  if (saved.length) {
    const index = saved.findIndex(phrase => phrase.id === lastTestId);
    const phrase = saved[(index + 1) % saved.length];
    lastTestId = phrase.id;
    coach.preview({ actionId: phrase.id, id: 'idle', text: phrase.text, animation: 'talk' });
  } else coach.idleNow();
  render();
};

function render() {
  $('.coach-test').disabled = thinking || !!pendingPromotion;
  const legal = selected ? game.moves({ square: selected, verbose: true }) : [];
  const last = game.history({ verbose: true }).at(-1);
  const focusedSquare = document.activeElement?.dataset.square;
  $('#board').innerHTML = game.board().flat().map((piece, index) => {
    const file = index % 8;
    const rank = 8 - Math.floor(index / 8);
    const square = `${'abcdefgh'[file]}${rank}`;
    const target = legal.some(move => move.to === square);
    const checked = piece?.type === 'k' && piece.color === game.turn() && game.isCheck();
    return `<button class="square ${(file + rank) % 2 ? 'dark' : 'pale'} ${selected === square ? 'selected' : ''} ${last && [last.from, last.to].includes(square) ? 'last-move' : ''} ${target ? 'legal' : ''} ${checked ? 'check' : ''}" data-square="${square}" aria-label="${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${names[piece.type]}` : ' empty'}${target ? ', legal destination' : ''}" aria-pressed="${selected === square}">
      ${file === 0 ? `<span class="rank coordinate">${rank}</span>` : ''}${rank === 1 ? `<span class="file coordinate">${'abcdefgh'[file]}</span>` : ''}${piece ? pixelPiece(piece) : ''}</button>`;
  }).join('');
  if (focusedSquare) $(`[data-square="${focusedSquare}"]`)?.focus({ preventScroll: true });
  let status = thinking ? 'Opponent is thinking…' : 'Your move. Make it a good one.';
  if (game.isCheckmate()) status = game.turn() === 'w' ? 'Checkmate. The opponent wins.' : 'Checkmate. You win!';
  else if (game.isStalemate()) status = 'Draw by stalemate.';
  else if (game.isThreefoldRepetition()) status = 'Draw by threefold repetition.';
  else if (game.isInsufficientMaterial()) status = 'Draw — insufficient material.';
  else if (game.isDraw()) status = 'Draw by the fifty-move rule.';
  else if (game.isCheck()) status = `${game.turn() === 'w' ? 'You are' : 'Opponent is'} in check.`;
  $('#thinking').textContent = game.isGameOver() ? status : game.isCheck() ? status : thinking ? 'THINKING…' : 'YOUR TURN';
  $('#thinking').title = $('#thinking').textContent;

}

function applyMove(move) {
  const before = new Chess(game.fen());
  const played = applyLegalMove(game, move);
  if (!played) return;
  selected = null;
  if (game.isGameOver()) {
    coach.review(game);
  } else {
    lastContext = moveContext(before, game, played);
    coach.react(lastContext);
  }
  render();
}

function cancelOpponent() {
  opponentGeneration++;
  clearTimeout(replyTimer);
  worker?.terminate();
  worker = null;
  thinking = false;
}

function finishOpponentMove(move) {
  cancelOpponent();
  if (!move) return;
  applyMove(move);
}

function opponentMove() {
  if (game.isGameOver() || game.turn() !== 'b') return;
  thinking = true;
  render();
  const token = ++opponentGeneration;
  let readyToPlay = false, resultReady = false, pendingMove, usedFallback = false;
  const isCurrent = () => token === opponentGeneration && !game.isGameOver() && game.turn() === 'b';
  const playWhenReady = () => {
    if (!isCurrent() || !readyToPlay || !resultReady) return;
    finishOpponentMove(pendingMove);
    if (usedFallback) $('#thinking').title = 'Opponent used a fallback move.';
  };
  const failed = () => {
    if (!isCurrent() || resultReady) return;
    // Prepare a legal fallback, respecting the same minimum move delay.
    pendingMove = game.moves({ verbose: true })[0];
    resultReady = true;
    usedFallback = true;
    playWhenReady();
  };
  try {
    worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = failed;
    worker.onmessage = ({ data }) => {
      if (!isCurrent() || resultReady) return;
      if (data.error || !data.move) { failed(); return; }
      pendingMove = data.move;
      resultReady = true;
      playWhenReady();
    };
    worker.postMessage({ pgn: game.pgn(), level });
  } catch { failed(); }
  if (!isCurrent()) return;
  // Calculate in parallel, but let the coach finish before changing the board.
  Promise.all([
    coach.whenFinished(),
    new Promise(resolve => { replyTimer = setTimeout(resolve, 1100); }),
  ]).then(() => {
    if (!isCurrent()) return;
    readyToPlay = true;
    playWhenReady();
  });
}

$('#board').addEventListener('click', event => {
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (!square || thinking || game.isGameOver() || game.turn() !== 'w') return;
  const candidates = selected ? game.moves({ square: selected, verbose: true }).filter(move => move.to === square) : [];
  if (candidates.length) {
    if (candidates.some(move => move.promotion)) {
      pendingPromotion = { from: selected, to: square };
      $('#promotion').showModal();
    } else { applyMove(candidates[0]); opponentMove(); }
  } else { selected = selected === square ? null : game.get(square)?.color === 'w' ? square : null; render(); }
});
$('#promotion').addEventListener('click', event => {
  const promotion = event.target.closest('[data-promotion]')?.dataset.promotion;
  if (!promotion || !pendingPromotion) return;
  applyMove({ ...pendingPromotion, promotion });
  pendingPromotion = null;
  $('#promotion').close();
  opponentMove();
});
$('#promotion').addEventListener('cancel', () => { pendingPromotion = null; });

$('#menu-button').onclick = () => { coach.stop(); $('#menu-dialog').showModal(); };
$('#close-menu').onclick = () => $('#menu-dialog').close();
$('#new-game').onclick = () => { $('#menu-dialog').close(); $('#level').value = level; $('#new-game-dialog').showModal(); };
$('#cancel-new-game').onclick = () => $('#new-game-dialog').close();
$('#learning').onclick = () => { $('#menu-dialog').close(); $('#learning-dialog').showModal(); };
$('#close-learning').onclick = () => { $('#learning-dialog').close(); $('#menu-dialog').showModal(); };
$('#new-game-form').onsubmit = event => {
  event.preventDefault();
  level = $('#level').value;
  $('#opponent-label').textContent = '~' + level;
  cancelOpponent(); coach.reset(); game.reset(); selected = null; lastContext = null; pendingPromotion = null;
  $('#new-game-dialog').close(); render();
};
$('#mute').onclick = () => {
  const muted = coach.toggleMute();
  $('#mute').title = muted ? 'Unmute coach audio' : 'Mute coach audio';
  $('#mute').setAttribute('aria-pressed', muted);
  $('#mute').setAttribute('aria-label', muted ? 'Unmute coach audio' : 'Mute coach audio');
};
coach.startIdle(() => !thinking && game.turn() === 'w' && !game.isGameOver() && !document.querySelector('dialog[open]') && !document.hidden);
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => coach.activity());
render();


