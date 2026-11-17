import { portraitPresets, phraseAnimations } from './portrait-config.js';
import { validateTimeline } from './animation-timeline.js';
import { performanceById } from './performance-catalog.js';

const string = { type: 'string' };
export const performanceSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'spokenText', 'segments'],
  properties: {
    summary: string, spokenText: string,
    // Keep provider grammar small. Bounds and valid asset IDs are enforced by
    // validatePerformance below; Gemini rejects large bounded-array grammars.
    segments: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['start', 'end', 'emotion', 'expression', 'gesture', 'speaking', 'confidence', 'performanceId', 'existingSet', 'reason', 'missingSet'],
      properties: {
        start: { type: 'number' }, end: { type: 'number' }, emotion: string, expression: string, gesture: string,
        speaking: { type: 'boolean' }, confidence: { type: 'number' },
        existingSet: { type: ['string', 'null'] }, reason: string,
        performanceId: { type: ['string', 'null'] },
        missingSet: {
          type: ['object', 'null'], additionalProperties: false, required: ['name', 'description', 'prompt'],
          properties: { name: string, description: string, prompt: string },
        },
      },
    } },
  },
};
function boundedText(value, label, max = 3000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid video response: ${label}.`);
  return value.trim();
}
export function validatePerformance(value, duration) {
  if (!value || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 96) throw new Error('Video response needs 1–96 timed sections.');
  let previous = 0;
  const segments = value.segments.map((item, index) => {
    if (!item || !Number.isFinite(item.start) || !Number.isFinite(item.end) || Math.abs(item.start - previous) > .05 || item.start < 0 || item.end <= previous || item.end > duration + .05) throw new Error('Video response timings must cover the clip without gaps or overlaps.');
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || typeof item.speaking !== 'boolean') throw new Error('Invalid video confidence or speech indicator.');
    if (item.existingSet !== null && !Object.hasOwn(portraitPresets, item.existingSet)) throw new Error('Video response names an unknown frame set.');
    if (item.performanceId != null && (!Object.hasOwn(performanceById, item.performanceId) || performanceById[item.performanceId].speaking !== item.speaking)) throw new Error('Video response names an invalid performance option.');
    const missingSet = item.missingSet === null ? null : {
      name: boundedText(item.missingSet?.name, 'asset name', 120),
      description: boundedText(item.missingSet?.description, 'asset description'),
      prompt: boundedText(item.missingSet?.prompt, 'art prompt', 5000),
    };
    const result = { start: previous, end: index === value.segments.length - 1 && Math.abs(item.end - duration) <= .05 ? duration : item.end,
      emotion: boundedText(item.emotion, 'emotion', 120), expression: boundedText(item.expression, 'expression'),
      gesture: boundedText(item.gesture, 'gesture'), reason: boundedText(item.reason, 'matching reason'),
      speaking: item.speaking, confidence: item.confidence, performanceId: item.performanceId || null, existingSet: item.existingSet, missingSet };
    // Silent gesture sheets cannot provide talking mouth frames.
    if (result.speaking && portraitPresets[result.existingSet]?.columns) {
      result.existingSet = null;
      result.missingSet ??= { name: `${result.emotion} talking gesture`, description: `${result.expression}. ${result.gesture}. Needs talking mouth frames.`, prompt: 'Create aligned closed, partly open, and open mouth frames for this gesture, using the approved Andrew illustration as the style reference.' };
    }
    previous = result.end;
    return result;
  });
  if (Math.abs(previous - duration) > .001) throw new Error('Video response does not cover the full clip.');
  return { summary: boundedText(value.summary, 'summary', 6000), spokenText: boundedText(value.spokenText, 'spoken text', 10000), segments };
}

export function performanceTimeline(plan, analysis) {
  if (plan.source !== analysis.source || Math.abs(plan.duration - analysis.duration) > .001) throw new Error('This video result belongs to a different take.');
  const fallback = phraseAnimations[analysis.phraseId]?.emotion || 'calm';
  const timeline = plan.segments.map(segment => {
    const matched = segment.existingSet && segment.confidence >= .6;
    return { start: segment.start, end: segment.end, emotion: matched ? segment.existingSet : segment.wordingSet || fallback,
      mouth: 'auto', needsReview: true,
      text: (analysis.transcript?.words || []).filter(word => word.start < segment.end && word.end > segment.start).map(word => word.text).join(' '),
      note: `${segment.expression} ${segment.gesture} ${segment.reason}${!matched ? ' Default expression used until reviewed.' : ''}${segment.missingSet ? ` Missing artwork: ${segment.missingSet.name}. ${segment.missingSet.description}` : ''}`.trim(),
    };
  });
  return validateTimeline(timeline, analysis.duration);
}
