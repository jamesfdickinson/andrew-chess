// Stable performance IDs are shared by video analysis, matching and art requests.
// Planned entries are directions for artwork, never claims that a playable set exists.
export const movementLabels = {
  portrait: 'Talking portrait', 'chin-rest': 'Chin resting on hand', 'arms-crossed': 'Arms crossed',
  point: 'Pointing', shrug: 'Shrug', 'lean-in': 'Lean forward', 'lean-back': 'Lean back',
  'head-tilt': 'Head tilt', 'open-palms': 'Open-palmed explanation', 'hands-clasped': 'Hands clasped',
  facepalm: 'Facepalm', 'hand-to-chest': 'Hand to chest', 'pawn-present': 'Present a pawn',
  'queen-reject': 'Reject a queen', 'talking-celebration': 'Talking celebration',
  nod: 'Nod', headshake: 'Head shake', anticipation: 'Anticipation', scared: 'Hands to face', celebrate: 'Quiet celebration', airpunch: 'Fist pump',
};
const groups = {
  portrait: ['neutral', 'pleased', 'happy!', 'confident', 'encouraging', 'skeptical', 'worried', 'curious', 'surprised!', 'sad', 'frustrated!', 'stern'],
  'chin-rest': ['sad', 'curious', 'neutral', 'frustrated!'],
  'arms-crossed': ['confident', 'encouraging', 'skeptical', 'sad', 'stern!'],
  point: ['encouraging', 'confident!', 'stern', 'frustrated!'],
  shrug: ['neutral', 'skeptical', 'sad', 'surprised!'],
  'lean-in': ['curious', 'encouraging', 'worried', 'stern!'],
  'lean-back': ['confident', 'skeptical', 'sad', 'surprised!'],
  'head-tilt': ['curious', 'skeptical', 'worried', 'pleased'],
  'open-palms': ['encouraging', 'neutral', 'skeptical', 'frustrated!'],
  'hands-clasped': ['curious', 'pleased', 'worried', 'confident'],
  facepalm: ['sad', 'skeptical', 'frustrated!', 'surprised!'],
  'hand-to-chest': ['pleased', 'sad', 'worried', 'surprised!'],
  'pawn-present': ['pleased', 'sad', 'confident!', 'surprised!'],
  'queen-reject': ['skeptical', 'stern', 'frustrated!', 'sad'],
  'talking-celebration': ['pleased', 'happy!', 'confident!', 'encouraging'],
};
const ready = {
  'portrait-neutral-subtle': ['calm'], 'portrait-pleased-subtle': ['pleased'], 'portrait-happy-emphatic': ['delighted'],
  'portrait-confident-subtle': ['smug'], 'portrait-encouraging-subtle': ['encouraging', 'encouraging-classic'],
  'portrait-skeptical-subtle': ['skeptical'], 'portrait-worried-subtle': ['concerned'], 'portrait-curious-subtle': ['curious'],
  'portrait-surprised-emphatic': ['shocked'], 'portrait-sad-subtle': ['disappointed'],
  'portrait-frustrated-emphatic': ['exasperated'], 'portrait-stern-subtle': ['stern'],
  'pawn-present-pleased-subtle': ['pawn-proud'], 'pawn-present-sad-subtle': ['pawn-sad'], 'queen-reject-frustrated-emphatic': ['queen-no'],
};
export const performanceCatalog = Object.entries(groups).flatMap(([movement, tones]) => tones.map(tone => {
  const emotion = tone.replace('!', ''), intensity = tone.endsWith('!') ? 'emphatic' : 'subtle';
  const stem = `${movement}-${emotion}-${intensity}`;
  return { id: `${stem}-talk`, movement, emotion, intensity, speaking: true,
    label: `${movementLabels[movement]} · ${emotion} · ${intensity}`, assets: ready[stem] || [] };
}));
for (const [movement, emotion, intensity] of [['nod', 'pleased', 'subtle'], ['headshake', 'stern', 'subtle'], ['anticipation', 'curious', 'subtle'], ['scared', 'worried', 'emphatic'], ['celebrate', 'happy', 'subtle'], ['airpunch', 'happy', 'emphatic']]) {
  performanceCatalog.push({ id: `${movement}-${emotion}-${intensity}-silent`, movement, emotion, intensity, speaking: false,
    label: `${movementLabels[movement]} · ${emotion} · ${intensity}`, assets: [movement] });
}
export const performanceById = Object.fromEntries(performanceCatalog.map(entry => [entry.id, entry]));
export const catalogVersion = 1;

function inferredMovement(segment) {
  const text = `${segment.gesture || ''} ${segment.expression || ''}`.toLowerCase();
  // Descriptive normalization only. Ignore side, camera angle and minor posture transitions.
  if (/(?:chin|head|cheek).{0,45}(?:rest|support|lean).{0,35}(?:hand|fist|palm)|(?:hand|fist|palm).{0,35}(?:support|under).{0,20}(?:chin|head|cheek)|chin.{0,15}(?:hand|fist)/.test(text)) return 'chin-rest';
  if (/(?:cross|fold).{0,20}arms|arms.{0,20}(?:cross|fold)/.test(text)) return 'arms-crossed';
  if (/facepalm|palm.{0,20}(?:forehead|face)|face.{0,15}in.{0,10}hands/.test(text)) return 'facepalm';
  if (/pawn/.test(text)) return 'pawn-present';
  if (/queen/.test(text)) return 'queen-reject';
  if (/point/.test(text)) return 'point';
  if (/shrug/.test(text)) return 'shrug';
  if (/clasp|steepl/.test(text)) return 'hands-clasped';
  if (/palms?.{0,20}(?:open|up)|open.{0,20}palms?/.test(text)) return 'open-palms';
  if (/hand.{0,20}(?:chest|heart)/.test(text)) return 'hand-to-chest';
  if (/fist.{0,20}(?:pump|rais)|punch/.test(text)) return segment.speaking ? 'talking-celebration' : 'airpunch';
  if (/celebrat|cheer/.test(text)) return segment.speaking ? 'talking-celebration' : 'celebrate';
  if (/shak.{0,12}head|head.{0,12}shak/.test(text)) return segment.speaking ? 'portrait' : 'headshake';
  if (/nod/.test(text)) return segment.speaking ? 'portrait' : 'nod';
  if (/lean.{0,15}(?:forward|in\b)/.test(text) && !/slight|small|subtle|minor/.test(text)) return 'lean-in';
  if (/lean.{0,15}back/.test(text) && !/slight|small|subtle|minor/.test(text)) return 'lean-back';
  if (/tilt/.test(text) && !/slight|small|subtle/.test(text)) return 'head-tilt';
  if (/still|neutral|upright|straight|subtle|slight|small|none|no (?:gesture|movement)/.test(text) || !segment.gesture?.trim()) return 'portrait';
  return null;
}
function inferredEmotion(segment) {
  const text = `${segment.emotion || ''} ${segment.expression || ''}`.toLowerCase();
  const labels = [
    ['sad', /sad|weary|solemn|disappoint|deject/], ['frustrated', /frustrat|angry|furious|exasperat/],
    ['surprised', /surpris|shock|astonish/], ['worried', /worr|fear|anxious|concern/], ['skeptical', /skeptic|doubt|disbelie/],
    ['stern', /stern|scold/], ['curious', /curious|thoughtful|ponder/], ['confident', /determined|confident|smug|firm/],
    ['encouraging', /encourag|reassur/], ['happy', /delight|ecstatic|excit|joy/], ['pleased', /happy|pleased|proud|smil/],
  ];
  return labels.find(([, pattern]) => pattern.test(text))?.[0] || 'neutral';
}
export function choosePerformance(segment) {
  const supplied = performanceById[segment.performanceId];
  if (supplied && supplied.speaking === segment.speaking) return { entry: supplied, method: 'video-model' };
  const movement = inferredMovement(segment), emotion = inferredEmotion(segment);
  const intensity = /emphatic|exaggerat|dramatic|forceful|furious|ecstatic|wide-eyed|shout/.test(`${segment.expression} ${segment.gesture} ${segment.emotion}`.toLowerCase()) ? 'emphatic' : 'subtle';
  const family = performanceCatalog.filter(entry => entry.movement === movement && entry.speaking === segment.speaking);
  const exact = family.find(entry => entry.emotion === emotion && entry.intensity === intensity);
  const sameTone = family.find(entry => entry.emotion === emotion);
  // Avoid forcing an unknown gesture or a different emotional tone into a family.
  return { entry: exact || sameTone || null, method: 'description-rules', movement, emotion, intensity };
}
export const emotionDirections = {
  neutral: 'Level relaxed eyebrows, relaxed eyelids, centered gaze, level mouth corners. No smile or frown.',
  pleased: 'Contented half-lidded eyes, gently lifted cheeks, relaxed low eyebrows and a small satisfied closed-lip smile. Calm satisfaction, not wide-eyed curiosity or a big grin.',
  happy: 'Strongly lifted cheeks, smiling crescent eyes and a broad joyful grin. Mouth corners remain high even while speaking.',
  confident: 'Chin slightly raised, steady half-lidded gaze, one subtly raised eyebrow and an asymmetric self-assured smirk.',
  encouraging: 'Warm direct eye contact, both eyebrows lifted in open supportive arcs, bright attentive eyes and a broad reassuring smile with raised cheeks. A small affirmative head dip in row two.',
  skeptical: 'One eyebrow distinctly raised and the other lowered, narrowed sideways eyes and a crooked doubtful mouth. Clearly asymmetric expression.',
  worried: 'Inner eyebrow ends raised and drawn together, tense widened eyes, slightly lowered mouth corners and a tense lower lip. No smile.',
  curious: 'One eyebrow raised high, the other gently drawn inward, eyes looking up and to the side, slight questioning head tilt and small pursed unsmiling lips. Thoughtful investigation, not a friendly smile.',
  surprised: 'Both eyebrows high above very wide round eyes, relaxed cheeks and a rounded O mouth when open. Closed-mouth frame retains wide eyes and high brows.',
  sad: 'Inner eyebrows slant upward, heavy lowered eyelids, downward gaze and visibly downturned mouth corners with a protruding lower lip. No smile.',
  frustrated: 'Eyebrows pulled sharply down and inward, narrowed tense eyes, scrunched nose and tense lips with downturned corners. Keep the angry upper face in every speaking frame.',
  stern: 'Low straight eyebrows, firm direct stare, slightly narrowed eyes and a flat compressed mouth. Serious disapproval without smiling or nose scrunching.',
};
export function artworkPrompt(entry) {
  const acting = emotionDirections[entry.emotion];
  if (!acting) throw new Error(`No facial acting direction for ${entry.emotion}`);
  return `Create a reusable illustrated coach performance: ${entry.label}. TARGET FACIAL ACTING: ${acting} ${entry.intensity === 'emphatic' ? 'Use strong, exaggerated facial shapes.' : 'Use restrained but unmistakable facial shapes, readable at thumbnail size.'} Establish this target expression BEFORE making mouth variants. The core portrait defines identity, NOT the expression to copy: replace its eyebrows, eyelids, gaze, cheeks and mouth attitude with the target acting. Preserve identity, head size, hair, clothing, palette and pixel scale. Use the expression sheet as an acting vocabulary, not as a layout to reproduce. Movement: ${movementLabels[entry.movement]}. The actor photo supplies gesture only; the target emotion controls the face. ${entry.speaking ? 'Produce three aligned frames of the target emotional pose: closed mouth, partly open mouth, open mouth. Only speech articulation changes WITHIN each row; retain the target eyebrows, eyes and emotional mouth corners in all three. Do not reset to the neutral reference smile.' : 'Produce a coherent three-frame silent gesture sequence with closed mouth and the target facial expression throughout.'} No captions, labels or extra characters. Keep composition and background consistent. Do not copy phrase-specific words or incidental camera angles. Catalog ID: ${entry.id}.`;
}
