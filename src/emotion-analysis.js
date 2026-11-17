// Model scores rank broad acoustic classes. They are not calibrated confidence
// in an actor's intended emotion, nor do they identify gestures or sarcasm.
const expressionFor = { angry: 'stern', happy: 'delighted', neutral: 'calm', sad: 'disappointed', surprised: 'shocked' };
const compatible = {
  angry: ['stern', 'exasperated', 'queen-no'], happy: ['pleased', 'delighted', 'encouraging', 'pawn-proud'],
  sad: ['disappointed', 'pawn-sad'], surprised: ['shocked'], neutral: ['calm'],
};

export function emotionSuggestion(segment, currentExpression) {
  const usable = segment?.status === 'estimated' && Number.isFinite(segment.score) && Number.isFinite(segment.margin);
  const clear = usable && segment.score >= .60 && segment.margin >= .15;
  const label = segment?.label ?? 'unknown';
  const missingAsset = clear && ['fearful', 'disgusted'].includes(label)
    ? `${label} talking portrait with closed, partly open and open mouth frames` : null;
  const suggestedEmotion = clear && expressionFor[label]
    ? compatible[label]?.includes(currentExpression) ? currentExpression : expressionFor[label] : null;
  const reason = !usable ? 'Not enough recognized speech for a reliable vocal-emotion suggestion.'
    : !clear ? 'Vocal-emotion scores are ambiguous; keep or choose the expression manually.'
    : missingAsset ? `No dedicated talking set for ${label}; consider creating ${missingAsset}.`
    : suggestedEmotion ? `Voice suggests ${label}; suggested animation: ${suggestedEmotion}.`
    : 'The model returned other/unknown; choose an expression manually.';
  return { label, score: segment?.score ?? 0, margin: segment?.margin ?? 0, suggestedEmotion, missingAsset, reason, needsReview: true };
}

export function emotionForRange(emotions, start, end) {
  if (emotions?.status !== 'complete') return null;
  const matches = (emotions.segments ?? []).map(segment => ({ segment, overlap: Math.max(0, Math.min(end, segment.end) - Math.max(start, segment.start)) }))
    .filter(item => item.overlap > 0).sort((a, b) => b.overlap - a.overlap);
  return matches[0]?.segment ?? null;
}

export function applyEmotionDraft(timeline, emotions) {
  return timeline.map(segment => {
    const evidence = emotionForRange(emotions, segment.start, segment.end);
    const suggestion = emotionSuggestion(evidence, segment.emotion);
    const speechNote = segment.note.replace(/Expression comes from phrase configuration; video performance has not been interpreted\./g, '').trim();
    const note = emotions?.status === 'complete' ? suggestion.reason
      : `Vocal emotion analysis ${emotions?.status === 'failed' ? 'failed' : 'is not installed'}; expression remains a phrase preset.`;
    return { ...segment, emotion: suggestion.suggestedEmotion ?? segment.emotion, needsReview: true,
      note: `${speechNote ? speechNote + ' ' : ''}${note} Facial expressions and gestures have not been analyzed.` };
  });
}

// Restore automatic choices even after a whole-phrase override or merged sections.
// Keep existing cuts, notes and edited text; add cuts at detected emotion changes.
export function restoreDetectedEmotions(timeline, emotions, fallbackEmotion = 'calm') {
  if (emotions?.status !== 'complete') throw new Error('Analyze vocal emotion first.');
  let matched = 0, fallback = 0;
  const restored = timeline.flatMap(segment => {
    const cuts = [...new Set([segment.start, segment.end, ...(emotions.segments || [])
      .flatMap(item => [item.start, item.end])
      .filter(at => Number.isFinite(at) && at > segment.start && at < segment.end)])].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((start, index) => {
      const end = cuts[index + 1];
      const suggestion = emotionSuggestion(emotionForRange(emotions, start, end), fallbackEmotion);
      if (suggestion.suggestedEmotion) matched++; else fallback++;
      return { ...segment, start, end, emotion: suggestion.suggestedEmotion || fallbackEmotion,
        mouth: 'auto', needsReview: true, text: index === 0 ? segment.text : '' };
    });
  });
  return { timeline: restored, matched, fallback };
}
