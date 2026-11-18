import { Chess } from 'chess.js';
import { coachConfig } from './coach-config.js';

function threatenedPlayerPawns(game) {
  if (game.isGameOver()) return [];
  const fen = game.fen().split(' ');
  // Inspect legal opponent captures without changing the live game.
  if (fen[1] !== 'b') {
    fen[1] = 'b';
    fen[3] = '-';
  }
  const opponent = new Chess(fen.join(' '));
  return [...new Set(opponent.moves({ verbose: true })
    .filter(move => move.captured === 'p')
    .filter(move => {
      // Warn for undefended pawns and equal pawn trades. Only recovering
      // a larger attacker suppresses the warning. Simulate the capture
      // so pinned defenders and promotions use the actual rules.
      opponent.move(move);
      const favorableRecapture = opponent.moves({ verbose: true })
        .some(reply => reply.to === move.to && reply.captured && reply.captured !== 'p');
      opponent.undo();
      return !favorableRecapture;
    })
    .map(move => move.flags.includes('e') ? move.to[0] + (Number(move.to[1]) + 1) : move.to))];
}

function playerCaptures(game) {
  if (game.isGameOver()) return [];
  const fen = game.fen().split(' ');
  if (fen[1] !== 'w') { fen[1] = 'w'; fen[3] = '-'; }
  return new Chess(fen.join(' ')).moves({ verbose: true }).filter(move => move.captured);
}
function largerPiecesAttackedByPawns(game) {
  return playerCaptures(game).filter(move => move.piece === 'p' && ['n', 'b', 'r', 'q'].includes(move.captured));
}

function pawnProtections(game) {
  const protections = [];
  for (const pawn of game.board().flat().filter(piece => piece?.color === 'w' && piece.type === 'p')) {
    const file = pawn.square.charCodeAt(0), rank = Number(pawn.square[1]) + 1;
    for (const offset of [-1, 1]) {
      if (file + offset < 97 || file + offset > 104 || rank > 8) continue;
      const target = `${String.fromCharCode(file + offset)}${rank}`;
      const piece = game.get(target);
      if (piece?.color !== 'w' || piece.type === 'k') continue;
      // Test a potential recapture, so pinned pawns are not credited as defenders.
      const fen = game.fen().split(' '); fen[1] = 'w'; fen[3] = '-';
      const probe = new Chess(fen.join(' '));
      probe.remove(target); probe.put({ type: 'n', color: 'b' }, target);
      if (probe.moves({ square: pawn.square, verbose: true }).some(move => move.to === target)) {
        protections.push({ pawn: pawn.square, square: target, piece: piece.type });
      }
    }
  }
  return protections;
}

function protectedPawns(game) {
  const protections = [];
  for (const pawn of game.board().flat().filter(piece => piece?.color === 'w' && piece.type === 'p')) {
    const fen = game.fen().split(' '); fen[1] = 'w'; fen[3] = '-';
    const probe = new Chess(fen.join(' '));
    probe.remove(pawn.square); probe.put({ type: 'n', color: 'b' }, pawn.square);
    for (const move of probe.moves({ verbose: true })) {
      if (move.to === pawn.square && move.captured) protections.push({ defender: move.from, pawn: pawn.square });
    }
  }
  return protections;
}

export function moveContext(before, game, move) {
  const pawnCaptures = before.moves({ verbose: true }).filter(candidate => candidate.captured === 'p');
  const recentMoves = game.history({ verbose: true }).slice(-2);
  const previousMove = recentMoves.length === 2 ? recentMoves[0] : null;
  // En passant captures behind the destination square.
  const capturedSquare = move.flags.includes('e')
    ? move.to[0] + (Number(move.to[1]) + (move.color === 'w' ? -1 : 1))
    : move.to;
  const capturedLastMover = !!(previousMove && previousMove.color !== move.color && move.captured && capturedSquare === previousMove.to);
  const recapture = capturedLastMover && !!previousMove.captured;
  const playerCapture = move.color === 'w' ? move : previousMove;
  const opponentCapture = move.color === 'b' ? move : previousMove;
  const trade = recapture ? { gave: opponentCapture.captured, got: playerCapture.captured, square: capturedSquare } : null;
  const previousPawnThreats = new Set(largerPiecesAttackedByPawns(before).map(item => `${item.from}-${item.to}`));
  const pawnThreats = move.color === 'w' ? largerPiecesAttackedByPawns(game)
    .filter(item => !previousPawnThreats.has(`${item.from}-${item.to}`)) : [];
  const oldPawnTargets = new Set(playerCaptures(before).filter(item => item.captured === 'p').map(item => `${item.from}-${item.to}`));
  const newPawnOpportunity = move.color === 'b' && playerCaptures(game).some(item =>
    item.captured === 'p' && !oldPawnTargets.has(`${item.from}-${item.to}`));
  const priorProtection = new Set(move.color === 'w' ? pawnProtections(before).map(item => `${item.pawn}-${item.square}`) : []);
  const newPawnProtections = move.color === 'w' ? pawnProtections(game)
    .filter(item => item.pawn === move.to && move.piece === 'p' &&
      !priorProtection.has(`${move.from}-${item.square}`)) : [];
  const priorPawnDefenders = new Set(move.color === 'w' ? protectedPawns(before).map(item => `${item.defender}-${item.pawn}`) : []);
  const newlyProtectedPawns = move.color === 'w' ? protectedPawns(game)
    .filter(item => item.defender === move.to &&
      !priorPawnDefenders.has(`${move.from}-${item.pawn}`)) : [];
  const history = game.history({ verbose: true });
  const pawnlessPlies = symbol => {
    let count = 0;
    for (const past of history.toReversed()) {
      if (past.after.split(' ')[0].includes(symbol)) break;
      count++;
    }
    return count;
  };
  const reminderDue = symbol => !game.isGameOver() && !game.isCheck() &&
    pawnlessPlies(symbol) > 1 && pawnlessPlies(symbol) % 8 === 0;
  const opponentHasPawns = game.board().flat().some(piece => piece?.color === 'b' && piece.type === 'p');
  return {
    opponentHasPawns,
    remindOutOfPawns: reminderDue('P'),
    remindOpponentOutOfPawns: reminderDue('p') && (!reminderDue('P') || pawnlessPlies('p') % 16 === 0),
    moveNumber: Number(before.fen().split(' ')[5]),
    newlyProtectedPawns,
    newPawnProtections,
    earlyPawnSetup: move.color === 'w' && move.piece === 'p' && !move.captured && !move.promotion &&
      Number(before.fen().split(' ')[5]) <= 6 && !game.isCheck() && pawnCaptures.length === 0 &&
      threatenedPlayerPawns(game).length === 0 && !playerCaptures(game).some(item => item.from === move.to),
    newPawnOpportunity,
    pawnThreats,
    pawnTookPiece: move.color === 'w' && move.piece === 'p' && ['n', 'b', 'r', 'q'].includes(move.captured),
    previousMove, recentMoves, capturedLastMover, recapture, trade,
    threatenedPawns: threatenedPlayerPawns(game),
    lostPawn: move.color === 'b' && move.captured === 'p',
    lostLastPawn: move.color === 'b' && move.captured === 'p' && !game.board().flat().some(piece => piece?.color === 'w' && piece.type === 'p'),
    move, fen: game.fen(), mover: move.color,
    pawnCaptures, missedPawn: pawnCaptures.length > 0 && move.captured !== 'p',
    check: game.isCheck(), gameOver: game.isGameOver(),
    checkmate: game.isCheckmate(), draw: game.isDraw(),
  };
}

export function chooseAction(actions, random = Math.random, previousId) {
  if (!actions?.length) return null;
  const alternatives = actions.filter(action => !previousId || action.actionId !== previousId);
  const pool = alternatives.length ? alternatives : actions;
  const totalWeight = pool.reduce((total, action) => total + (action.weight ?? 1), 0);
  let pick = random() * totalWeight;
  for (const action of pool) {
    pick -= action.weight ?? 1;
    if (pick < 0) return action;
  }
  return pool.at(-1);
}

export function chooseReaction(context, random = Math.random, config = coachConfig, previousId) {
  const opponent = context.mover === 'b' || context.move?.color === 'b';
  const events = [...(config.priorityEvents ?? []), ...(config.twoMoveEvents ?? []), ...(opponent ? (config.opponentEvents ?? []) : config.events)];
  let event = events.find((event, index) => index === events.length - 1 || event.when?.(context));
  const otherwiseQuiet = !event || event.silent || !event.actions?.length;
  if (otherwiseQuiet && context.remindOpponentOutOfPawns) {
    event = config.priorityEvents?.find(item => item.id === 'opponent-out-of-pawns') ?? event;
  } else if (otherwiseQuiet && context.remindOutOfPawns && !context.lostLastPawn) {
    event = config.priorityEvents?.find(item => item.id === 'out-of-pawns') ?? event;
  }
  if (event?.silent) return null;
  if (event?.gestureChance) {
    const gestures = event.actions.filter(action => action.kind === 'gesture');
    const spoken = event.actions.filter(action => action.kind !== 'gesture');
    const pool = random() < event.gestureChance(context) ? gestures : spoken;
    const action = chooseAction(pool, random, previousId);
    return action ? { ...action, id: event.id } : null;
  }
  // Only the forfeit line remains accurate when neither side has pawns.
  const actions = event?.id === 'out-of-pawns' && context.opponentHasPawns === false
    ? event.actions.filter(action => action.actionId === 'out-of-pawns-01') : event?.actions;
  const action = chooseAction(actions, random, previousId);
  return action ? { ...action, id: event.id } : null;
}

// Rebuild from the actual move history so Undo never leaves stale statistics.
export function reviewContext(game) {
  const history = game.history({ verbose: true });
  let pawnsCaptured = 0;
  const missed = [];
  for (const move of history) {
    if (move.color !== 'w') continue;
    if (move.captured === 'p') pawnsCaptured++;
    const before = new Chess(move.before);
    if (move.captured !== 'p' && before.moves({ verbose: true }).some(candidate => candidate.captured === 'p')) {
      missed.push({ san: move.san, captured: move.captured, moveNumber: Number(move.before.split(' ')[5]) });
    }
  }
  return { pawnsCaptured, missed };
}

export function chooseReview(game, random = Math.random, config = coachConfig) {
  if (!game.isGameOver()) return null;
  const context = reviewContext(game);
  const settings = config.review;
  const tier = settings.tiers.find(item => context.pawnsCaptured >= item.minPawns);
  const action = chooseAction(tier?.actions, random);
  if (!action) return null;
  const highlight = context.missed.find(move => move.captured === 'q') ?? context.missed[0];
  let text = action.text;
  if (highlight) {
    const template = highlight.captured === 'q' ? settings.missedQueen : settings.missedPawn;
    text += ' ' + template.replace('{moveNumber}', highlight.moveNumber).replace('{san}', highlight.san);
  }
  const rating = Math.min(100, Math.max(0, settings.baseRating + settings.pointsPerPawn * context.pawnsCaptured));
  const ratingExplanation = `${context.pawnsCaptured} enemy pawn${context.pawnsCaptured === 1 ? '' : 's'} captured. ${settings.baseRating} starting points + ${settings.pointsPerPawn} per pawn (maximum 100). Missed pawns are feedback, not deductions. This is the coach's pawn score, not chess accuracy.`;
  return { ...action, text, rating, ratingExplanation, id: 'game-review' };
}

export function createCoach(root, { recordedVideo = () => null, recordedAnimation = () => null, recordedMouth = () => [], portrait, getName = () => coachConfig.name } = {}) {
  const stage = root.querySelector('.coach-stage');
  const video = root.querySelector('audio') || root.querySelector('video');
  const speech = root.querySelector('.speech');
  const reviewRating = root.querySelector('.review-rating');
  const synthesis = globalThis.speechSynthesis;
  let utterance;
  let muted = false;
  let animationTimer;
  let idleTimer;
  let generation = 0;
  let lastAction;
  let canIdle = () => false;
  let busy = false;
  let finished = Promise.resolve();
  let resolveFinished;
  const queue = [];

  function enqueue(action) {
    if (busy) queue.push(action);
    else play(action);
  }

  function complete() {
    busy = false;
    resolveFinished?.();
    resolveFinished = null;
  }

  function activity() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (canIdle() && !busy) {
        const action = chooseAction(coachConfig.idle.filter(action => !action.requiresRecording || recordedVideo(action)), Math.random, lastAction?.actionId);
        if (action) play({ ...action, id: 'idle' });
      }
      activity();
    }, coachConfig.idleAfterMs);
  }

  function stop(clearQueue = true) {
    portrait?.stop();
    if (clearQueue) queue.length = 0;
    generation++;
    synthesis?.cancel();
    utterance = null;
    clearTimeout(animationTimer);
    complete();
    video.onended = video.onerror = video.onplaying = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    stage.className = 'coach-stage';
  }

  function play(action) {
    const approved = action.kind === 'gesture' ? null : recordedAnimation(action);
    if (approved) action = { ...action, text: approved.spokenText, animationCues: approved.cues, endingEmotion: approved.endingEmotion };
    action = { ...action, video: action.kind === 'gesture' ? null : recordedVideo(action) || action.video };
    action = { ...action, mouthCues: action.video ? recordedMouth(action) : [] };
    stop(false);
    lastAction = action;
    const token = generation;
    speech.textContent = action.text;
    speech.classList?.toggle('stage-direction', action.kind === 'gesture');
    reviewRating.hidden = action.rating === undefined;
    reviewRating.textContent = action.rating === undefined ? '' : `${getName().toUpperCase()}'S PAWN RATING: ${action.rating}/100\n${action.ratingExplanation ?? ''}`;
    root.classList.toggle('reviewing', action.rating !== undefined);
    root.querySelector('.reaction-tag').textContent = action.id.replaceAll('-', ' ');
    void stage.offsetWidth;
    stage.classList.add(action.animation ?? 'talk');
    portrait?.play(action);

    busy = true;
    finished = new Promise(resolve => { resolveFinished = resolve; });
    const finish = () => {
      if (token !== generation || !busy) return;
      portrait?.finish();
      complete();
      const next = queue.shift();
      if (next) play(next);
      else activity();
    };
    if (action.kind === 'gesture') {
      animationTimer = setTimeout(finish, action.durationMs || 2400);
      activity();
      return;
    }
    let speaking = false;
    const speak = () => {
      if (speaking || muted || !coachConfig.speech.enabled || !synthesis || !globalThis.SpeechSynthesisUtterance) return false;
      speaking = true;
      utterance = new SpeechSynthesisUtterance(action.rating === undefined ? action.text : 'My rating for your game: ' + action.rating + ' out of 100. ' + action.text);
      utterance.lang = coachConfig.speech.lang;
      utterance.rate = coachConfig.speech.rate;
      utterance.pitch = coachConfig.speech.pitch;
      utterance.volume = coachConfig.volume;
      utterance.onstart = () => { if (token === generation) portrait?.sync?.(); };
      utterance.onend = utterance.onerror = finish;
      try { synthesis.speak(utterance); } catch { finish(); }
      return true;
    };
    if (action.video) {
      video.src = action.video;
      video.muted = muted;
      video.volume = coachConfig.volume;
      stage.classList.add('has-video');
      const fallback = () => {
        if (token !== generation) return;
        stage.classList.remove('has-video');
        video.pause();
        // Synthesized speech has a different pace from the actor's recording.
        portrait?.play({ ...action, video: null, mouthCues: [], animationCues: [] });
        if (!speak()) finish();
      };
      video.onerror = fallback;
      video.onplaying = () => { if (token === generation) portrait?.sync?.(() => video.currentTime); };
      video.onended = finish;
      video.play().catch(fallback);
    } else speak();
    animationTimer = setTimeout(() => {
      if (token !== generation) return;
      stage.classList.remove('talk', 'point', 'bounce', 'shake', 'shrug');
      if (!action.video && !speaking) finish();
    }, 2400);
    activity();
  }

  function reset() {
    stop(); lastAction = null;
    reviewRating.hidden = true;
    reviewRating.textContent = '';
    root.classList.remove('reviewing');
    speech.textContent = `Hi, I'm ${getName()}. Look for pawns you can take!`;
    speech.classList?.remove('stage-direction');
    root.querySelector('.reaction-tag').textContent = 'standing by';

    activity();
  }

  return {
    review(game) { const action = chooseReview(game); if (action) enqueue(action); },
    react(context) {
      const action = chooseReaction(context, Math.random, coachConfig, queue.at(-1)?.actionId ?? lastAction?.actionId);
      if (action) enqueue(action);
      else if (!busy) portrait?.quiet?.(context);
    },
    replay() { if (lastAction) enqueue(lastAction); },
    preview(action) { stop(); play(action); },
    idleNow() {
      const action = chooseAction(coachConfig.idle.filter(action => !action.requiresRecording || recordedVideo(action)), Math.random, lastAction?.actionId);
      if (action) { stop(); play({ ...action, id: 'idle' }); }
    },
    stop, reset, activity,
    async whenFinished() { while (busy) await finished; },
    startIdle(predicate) { canIdle = predicate; activity(); },
    toggleMute() {
      muted = !muted; video.muted = muted;
      if (muted) {
        const finish = utterance?.onend;
        if (utterance) utterance.onend = utterance.onerror = null;
        synthesis?.cancel();
        if (!lastAction?.video) finish?.();
      }
      return muted;
    },
  };
}