import { choosePerformance, performanceById, performanceCatalog, artworkPrompt } from './performance-catalog.js';

export const actingModes = ['natural', 'expressive', 'theatrical', 'gestures'];
export function retainWordingDirection(plan, analysis) {
  if (!analysis.timeline?.length) return plan;
  const segments = plan.segments.flatMap(segment => {
    const movement = choosePerformance(segment).entry?.movement;
    return analysis.timeline.filter(part => part.start < segment.end && part.end > segment.start).map(part => {
      const direction = performanceCatalog.find(entry => entry.assets.includes(part.emotion)) || performanceById[part.emotion?.replace(/^generated-/, '').replace(/-ref-[a-f0-9]{12}$/, '')];
      const tone = direction?.emotion || 'neutral';
      const target = performanceCatalog.find(entry => entry.movement === movement && entry.emotion === tone && entry.speaking) ||
        performanceCatalog.find(entry => entry.movement === movement && entry.emotion === tone);
      return { ...segment, start: Math.max(part.start, segment.start), end: Math.min(part.end, segment.end),
        observedEmotion: segment.emotion, observedSpeaking: segment.speaking, emotion: tone, wordingSet: part.emotion,
        performanceId: target?.id || null, speaking: target?.speaking ?? true, existingSet: part.emotion,
        missingSet: target ? null : { name: `${tone} · ${movement || 'gesture'}`, description: `${segment.gesture}; retain ${part.emotion} acting.`, prompt: `Create a reusable ${tone} talking set with this gesture: ${segment.gesture}. Preserve the approved Andrew illustration and aligned mouth frames.` },
        reason: `${segment.reason} Wording direction retained: ${part.emotion}; video supplies gesture only.` };
    });
  });
  return { ...plan, segments };
}
export function performanceForSet(set) {
  return performanceCatalog.find(entry => entry.assets.includes(set)) || performanceById[set?.replace(/^generated-/, '').replace(/-ref-[a-f0-9]{12}$/, '')] || null;
}

// Built-in illustrations belong to the original avatar, never a replacement
// reference. Keep their frames as temporary fallbacks while new art is prepared.
export function resolveTimelineArtwork(timeline, library = [], referenceId = 'original') {
  const assets = library.filter(item => item.currentReference !== false && (item.referenceId || 'original') === referenceId);
  const required = new Map();
  const resolved = timeline.map(({ artworkPerformance, ...segment }) => {
    const entry = performanceById[artworkPerformance] || performanceForSet(segment.emotion);
    if (!entry) return segment;
    const record = assets.find(item => (item.performanceId || item.key) === entry.id);
    if (record?.status === 'approved') return { ...segment, emotion: record.setId };
    if (referenceId === 'original' && entry.assets.length) return { ...segment, emotion: entry.assets.includes(segment.emotion) ? segment.emotion : entry.assets[0] };
    required.set(entry.id, { key: entry.id, name: entry.label, speaking: entry.speaking, status: record?.status || 'missing', record });
    return segment;
  });
  return { timeline: resolved, requirements: [...required.values()] };
}

export function matchPerformance(plan, library = [], { referenceId = 'original' } = {}) {
  library = library.filter(item => item.currentReference !== false && (item.referenceId || 'original') === referenceId);
  const missing = new Map();
  const segments = plan.segments.map(original => {
    const segment = { ...original };
    // DGX is a separate art direction, never an automatic substitute in this library.
    if (segment.existingSet === 'dgx-calm-pilot') {
      segment.existingSet = 'calm';
      segment.reason += ' Original calm frames replace the DGX pilot to keep the illustrated style consistent.';
    }
    const { entry } = choosePerformance(segment);
    segment.performanceId = entry?.id || null;
    if (entry && segment.confidence >= .6) {
      const generated = library.find(item => (item.performanceId || item.key) === entry.id && item.status === 'approved');
      if (generated || referenceId === 'original' && entry.assets.length) {
        // Retain the model's suitable variant; otherwise make a stable choice.
        segment.existingSet = generated?.setId || (entry.assets.includes(segment.existingSet) ? segment.existingSet : entry.assets[0]);
        segment.missingSet = null;
      } else {
        segment.missingSet = { name: entry.label, description: `${entry.label}; ${entry.speaking ? 'talking mouth frames' : 'silent gesture'}.`, prompt: artworkPrompt(entry) };
      }
    }
    if (segment.missingSet) {
      const key = entry?.id || null;
      const prior = plan.missingAssets?.find(item => item.start === segment.start && item.end === segment.end);
      const record = key && library.find(item => (item.performanceId || item.key) === key);
      const request = { ...segment.missingSet, key, start: segment.start, end: segment.end, speaking: segment.speaking,
        reference: prior?.reference || plan.frames?.find(frame => frame.at >= segment.start && frame.at <= segment.end) || null,
        status: record?.status || (key && segment.confidence >= .6 ? 'missing' : 'needs-review'), record: record || null };
      // Normalize repeated descriptions to one reusable request, across timed sections.
      const identity = key || `review-${segment.start}`;
      if (!missing.has(identity)) missing.set(identity, request);
      segment.assetKey = key;
    }
    return segment;
  });
  return { ...plan, segments, referenceId, missingAssets: [...missing.values()], matchingRevision: JSON.stringify([referenceId, library.map(a => [a.key, a.status, a.setId])]) };
}

export function generationCandidates(plan) {
  return plan.missingAssets.filter(item => item.status === 'missing' && item.key && performanceById[item.key]);
}
