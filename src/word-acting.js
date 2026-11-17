import { performanceCatalog } from './performance-catalog.js';

// Broad comic intentions, with variety inside a suitable family. This is acting
// direction based on words, not a claim about the speaker's actual feelings.
export function wordActing(timeline, { phraseId = '', text = '', variation = 0 } = {}) {
  return timeline.map((segment, index) => {
    const words = (segment.text?.trim() || text).toLowerCase();
    let choices;
    if (/\b(no pawns|last pawn|pawns? (?:left|lost)|lost (?:a |the |our )?pawn|gone|disappoint|tragedy|terrible|disaster)\b/.test(words)) choices = ['pawn-sad', 'disappointed', 'exasperated'];
    else if (/\b(smile|excellent|brilliant|beautiful|well done|nice|great|proud|thank|love|lovely|good job|worth)\b/.test(words)) choices = ['encouraging', 'pleased', 'delighted'];
    else if (/\b(careful|danger|protect|watch out|threat|risk|worry|help)\b/.test(words)) choices = ['concerned', 'stern', 'skeptical'];
    else if (/\b(go get|take|capture|collect|win|attack|plan|forward|theirs|let.s go)\b/.test(words)) choices = ['smug', 'encouraging', 'delighted'];
    else if (/\b(queen|why|really|sure|seriously|mistake|wrong)\b/.test(words)) choices = ['skeptical', 'exasperated', 'stern'];
    else if (/\b(maybe|think|wonder|look|consider|what|how|where|could)\b/.test(words)) choices = ['curious', 'skeptical', 'encouraging'];
    else choices = ['curious', 'encouraging', 'pleased'];
    let seed = 0;
    for (const char of `${phraseId}:${index}`) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    const emotion = choices[(seed + variation) % choices.length];
    return { ...segment, emotion, mouth: 'auto', needsReview: true,
      note: `${(segment.note || '').replace(/Expression comes from phrase configuration; video performance has not been interpreted\./g, '').replace(/Wording-based comic acting: [^;]+; review the intended meaning\./g, '').trim()} Wording-based comic acting: ${emotion}; review the intended meaning.`.trim() };
  });
}

export function suggestedWordEmotions(text, phraseId = '') {
  return [...new Set([0, 1, 2].map(variation => wordActing([{ text }], { phraseId, text, variation })[0].emotion))];
}

export function sequenceLabel(timeline) {
  return timeline.filter((segment, index) => !index || segment.emotion !== timeline[index - 1].emotion)
    .map(segment => segment.emotion.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase())).join(' → ');
}

export function suggestedWordSequences(timeline, options = {}) {
  const seen = new Set();
  return [0, 1, 2].flatMap(variation => {
    const requested = new Set();
    const sequence = wordActing(timeline, { ...options, variation }).map(segment => {
      // Only explicit gesture wording adds an artwork direction. Ordinary speech
      // continues to use the existing portrait sets without spending on images.
      const text = segment.text || options.text || '';
      const movement = /\bshrug\b/i.test(text) ? 'shrug' : /\b(?:cross|fold) (?:my|your|his|the) arms\b/i.test(text) ? 'arms-crossed' : /\bhand (?:on|under) (?:my|your|his|the) chin\b/i.test(text) ? 'chin-rest' : /\b(?:point at|point to|pointing)\b/i.test(text) ? 'point' : null;
      const tone = performanceCatalog.find(entry => entry.assets.includes(segment.emotion))?.emotion;
      const direction = movement && performanceCatalog.find(entry => entry.movement === movement && entry.emotion === tone && entry.speaking);
      if (direction && !direction.assets.length && (requested.has(direction.id) || requested.size < 2)) {
        requested.add(direction.id);
        return { ...segment, artworkPerformance: direction.id };
      }
      return segment;
    });
    const signature = JSON.stringify(sequence.map(segment => segment.emotion));
    if (seen.has(signature)) return [];
    seen.add(signature);
    const missingPerformanceIds = [...new Set(sequence.map(segment => segment.artworkPerformance).filter(Boolean))];
    return [{ id: `words-${variation}`, label: sequenceLabel(sequence), timeline: sequence, missingPerformanceIds }];
  });
}
