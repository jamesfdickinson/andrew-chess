import { sheetFiles, sheetUrl } from './coach-artwork.js';
import { performanceCatalog } from './performance-catalog.js';
import { portraitDirection, portraitBeats, portraitCue } from './portrait-emotion.js';
import { portraitPresets } from './portrait-config.js';

export function attachCoachPortrait(root, { getCoach = () => ({ id: 'jimmy' }) } = {}) {
  const stage = root.querySelector('.coach-stage');
  root.classList.add('portrait-preview');
  const portrait = document.createElement('div');
  portrait.className = 'coach-portrait';
  portrait.setAttribute('role', 'img');
  portrait.setAttribute('aria-label', 'Pixel-art chess coach');
  stage.prepend(portrait);
  const sheets = Object.fromEntries(Object.entries(sheetFiles).map(([key, file]) => [key, sheetUrl(file)]));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let emotion = 'calm', speaking = false, timer, mouth = 0, began = 0, beats = [];
  let direction = { endingEmotion: 'calm', cues: [] }, clock, quietTimer, mouthCues = [];
  let lastQuietGesture = -Infinity;
  function show(column = 0, seconds = 0) {
    mouth = column;
    const coach = getCoach();
    let preset = portraitPresets[emotion] || portraitPresets.calm;
    if (coach.reference?.id !== 'original' && (coach.id !== 'jimmy' || coach.reference?.image)) {
      const match = performanceCatalog.find(item => item.assets.includes(emotion));
      const asset = coach.assets?.find(item => item.status === 'approved' && item.referenceId === coach.reference?.id && item.performanceId === match?.id);
      const ownGenerated = coach.assets?.some(item => item.setId === emotion);
      if (asset) preset = portraitPresets[asset.setId] || preset;
      else if (!ownGenerated) {
        portrait.style.backgroundImage = coach.reference?.image ? `url("${coach.reference.image}")` : 'none';
        portrait.style.backgroundSize = '100% 100%'; portrait.style.backgroundPosition = 'center';
        portrait.setAttribute('aria-label', coach.reference?.image ? 'Coach portrait; emotion artwork pending' : 'Coach artwork not created yet');
        return;
      }
    }
    if (preset.columns) column = speaking && !motion.matches
      ? preset.columns[Math.floor(seconds / preset.step)] ?? preset.restingColumn : preset.restingColumn;
    const rows = preset.rows || 4;
    const row = speaking && !motion.matches && preset.gesture
      ? preset.gesture[Math.floor(seconds / preset.step)] ?? preset.row : preset.row;
    portrait.style.backgroundImage = `url("${preset.image || sheets[preset.sheet]}")`;
    portrait.style.backgroundSize = `300% ${rows * 100}%`;
    portrait.style.backgroundPosition = `${column * 50}% ${rows > 1 ? row * 100 / (rows - 1) : 0}%`;
    portrait.dataset.emotion = emotion;
    portrait.dataset.mouth = preset.columns ? '0' : String(column);
  }
  function schedule() {
    clearTimeout(timer);
    if (document.hidden || motion.matches) return;
    timer = setTimeout(() => {
      if (speaking) {
        const elapsed = clock ? clock() * 1000 : performance.now() - began;
        const cue = portraitCue(direction.cues, elapsed / 1000);
        if (cue?.emotion) emotion = cue.emotion;
        const beat = beats.find(item => elapsed <= item.end + item.pause);
        const pause = beat && elapsed >= beat.end;
        const audioMouth = mouthCues.length ? portraitCue(mouthCues, elapsed / 1000)?.mouth ?? 0 : undefined;
        show(cue?.mouth ?? audioMouth ?? (pause ? 0 : (mouth + 1 + Math.floor(Math.random() * 2)) % 3), elapsed / 1000 - (cue?.segmentStart ?? 0));
      } else {
        quiet({ newPawnOpportunity: Math.random() < 0.35 });
        return;
      }
      schedule();
    }, speaking ? (direction.cues.length || mouthCues.length ? 50 : 150 + Math.random() * 140) : 18000 + Math.random() * 12000);
  }
  function finish() { clearTimeout(quietTimer); speaking = false; clock = null; emotion = direction.endingEmotion; show(0); schedule(); }
  function stop() { direction = { endingEmotion: 'calm', cues: [] }; finish(); }
  function play(action) {
    clearTimeout(quietTimer);
    direction = portraitDirection(action);
    emotion = direction.emotion;
    clock = action.video ? () => 0 : null;
    mouthCues = action.mouthCues || [];
    beats = portraitBeats(action.text);
    began = performance.now(); speaking = true;
    show(0); schedule();
  }
  function resume() { if (motion.matches) show(0); schedule(); }
  stop();
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', resume);
  function quiet(context) {
    // Quiet moves should mostly leave Andrew at rest, not nod on every turn.
    if (performance.now() - lastQuietGesture < 15000 || Math.random() >= 0.25) {
      if (!speaking) schedule();
      return;
    }
    lastQuietGesture = performance.now();
    const emotion = context.threatenedPawns?.length ? 'scared' : context.newPawnOpportunity ? 'anticipation' : 'nod';
    play({ emotion, text: '', kind: 'gesture' });
    quietTimer = setTimeout(finish, 2400);
  }
  return { refresh: () => show(mouth), play, quiet, finish, stop, sync(playbackClock) { clock = playbackClock; began = performance.now(); } };
}
