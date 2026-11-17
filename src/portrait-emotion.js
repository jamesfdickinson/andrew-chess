import { portraitPresets, phraseAnimations } from './portrait-config.js';

export function portraitEmotion(action = {}) {
  if (Object.hasOwn(portraitPresets, action.emotion)) return action.emotion;
  const configured = phraseAnimations[action.actionId];
  if (configured) return configured.emotion;
  const id = action.actionId || action.id || '';
  if (/^(queen-for-pawn|piece-for-pawn|advanced-pawn-taken|took-pawn)/.test(id)) return 'pleased';
  if (/^(out-of-pawns|pawn-for-piece|queen-over-pawn|piece-over-pawn|missed-pawn|lost-pawn)/.test(id)) return 'skeptical';
  if (/^(pawn-in-danger|pawn-under-attack)/.test(id)) return 'concerned';
  if (action.rating !== undefined) return action.rating >= 70 ? 'pleased' : action.rating < 40 ? 'skeptical' : 'calm';
  if (/watch out|danger|careful|protect/i.test(action.text || '')) return 'concerned';
  if (/excellent|brilliant|beautiful|nice find|love|lovely/i.test(action.text || '')) return 'pleased';
  if (/disappoint|bad |wrong|refund|why /i.test(action.text || '')) return 'skeptical';
  return 'calm';
}

export function portraitDirection(action = {}) {
  const preset = phraseAnimations[action.actionId] || {};
  const emotion = portraitEmotion(action);
  const cues = (action.animationCues || preset.cues || []).filter(cue =>
    Number.isFinite(cue.at) && cue.at >= 0 &&
    (cue.emotion === undefined || Object.hasOwn(portraitPresets, cue.emotion)) &&
    (cue.mouth === undefined || [0, 1, 2].includes(cue.mouth))
  ).slice().sort((a, b) => a.at - b.at);
  return { emotion, endingEmotion: Object.hasOwn(portraitPresets, action.endingEmotion) ? action.endingEmotion : preset.endingEmotion || emotion, cues };
}

export function portraitCue(cues, seconds) {
  return cues.filter(cue => cue.at <= seconds).at(-1);
}

export function portraitBeats(text = '') {
  let end = 0;
  return (text.match(/[^.!?;,]+[.!?;,]*/g) || ['']).map(clause => {
    end += Math.max(650, clause.trim().split(/\s+/).length * 340);
    const beat = { end, pause: /[.!?;,]$/.test(clause) ? 320 : 100 };
    end += beat.pause;
    return beat;
  });
}
