import { portraitPresets, phraseAnimations } from './portrait-config.js';

export { sheetFiles } from './coach-artwork.js';
export function makeDraft(phraseId, duration, transcript) {
  const emotion = phraseAnimations[phraseId]?.emotion || 'calm';
  const words = transcript.words || [];
  const boundaries = new Set([0, duration]);
  for (let at = 3; at < duration; at += 3) boundaries.add(at);
  const times = [...boundaries].sort((a, b) => a - b);
  return times.slice(0, -1).map((start, index) => {
    const end = times[index + 1];
    const matching = words.filter(word => word.start < end && word.end > start);
    const uncertain = matching.some(word => word.probability < 0.65);
    return { start, end, emotion, mouth: 'auto', text: matching.map(word => word.text).join(' '), needsReview: true,
      note: `${!words.length ? 'No speech recognized. Listen to the source and enter the actual line if present. ' : uncertain ? 'Uncertain speech recognition. ' : ''}Expression comes from phrase configuration; video performance has not been interpreted.` };
  });
}
export function validateTimeline(value, duration) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('Timeline needs 1–500 segments.');
  let previous = 0;
  const segments = value.map((item, index) => {
    if (!item || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > duration + 0.001 || Math.abs(item.start - previous) > 0.001) throw new Error(`Segment ${index + 1} must join the previous segment and stay within the clip.`);
    if (!Object.hasOwn(portraitPresets, item.emotion) || !['auto', 0, 1, 2].includes(item.mouth)) throw new Error(`Invalid animation or mouth in segment ${index + 1}.`);
    previous = item.end;
    return { start: item.start, end: item.end, emotion: item.emotion, mouth: item.mouth, text: String(item.text || '').slice(0, 2000), needsReview: item.needsReview !== false, note: String(item.note || '').slice(0, 2000) };
  });
  if (Math.abs(previous - duration) > 0.001) throw new Error('Timeline must cover the full clip.');
  return segments;
}
export function frameAt(timeline, envelope, seconds) {
  const segment = timeline.find(item => seconds >= item.start && seconds < item.end) || timeline.at(-1);
  if (!segment) return { emotion: 'calm', mouth: 0, elapsed: 0 };
  const sample = envelope?.[Math.floor(seconds * 20)];
  const mouth = segment.mouth === 'auto' ? (sample?.mouth || 0) : segment.mouth;
  return { emotion: segment.emotion, mouth, elapsed: Math.max(0, seconds - segment.start) };
}
export function timelineCues(timeline, envelope, duration) {
  const times = [...new Set([...timeline.map(item => item.start), ...envelope.map(item => item.at), duration])].sort((a, b) => a - b);
  const cues = [];
  for (const at of times) {
    if (at > duration) continue;
    const frame = frameAt(timeline, envelope, at);
    if (at === duration) frame.mouth = 0;
    const last = cues.at(-1);
    if (!last || last.emotion !== frame.emotion || last.mouth !== frame.mouth || timeline.some(item => item.start === at)) cues.push({ at, emotion: frame.emotion, mouth: frame.mouth, segmentStart: at - frame.elapsed });
  }
  return cues;
}

// Automatic audio timing is independent of reviewed expression/gesture choices.
export function mouthSync(analysis) {
  const cues = [{ at: 0, mouth: 0 }];
  for (const sample of analysis.envelope || []) {
    if (sample.at < 0 || sample.at >= analysis.duration || ![0, 1, 2].includes(sample.mouth)) continue;
    if (cues.at(-1).mouth !== sample.mouth) cues.push({ at: sample.at, mouth: sample.mouth });
  }
  cues.push({ at: analysis.duration, mouth: 0 });
  return { source: analysis.source, method: 'audio-amplitude', cues };
}
