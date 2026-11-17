export function recordedPerformance(saved) {
  const animation = saved?.original && saved.animation?.source === saved.original ? saved.animation : null;
  const timing = saved?.original && saved.mouthSync?.source === saved.original ? saved.mouthSync : null;
  const audio = saved?.audio?.source === saved?.original ? saved?.audio?.url : null;
  return { video: audio || saved?.original || saved?.video || null, animation, mouthCues: timing?.cues || [] };
}

export function recordedIdlePhrases(phrases, recordings) {
  return phrases.filter(phrase => phrase.event === 'idle' && (recordings[phrase.id]?.original || recordings[phrase.id]?.video));
}
