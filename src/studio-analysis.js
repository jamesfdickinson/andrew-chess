import { sheetUrl } from './coach-artwork.js';
import { coachFetch as fetch, selectedCoach } from './coach-session.js';
import { portraitPresets, phraseAnimations } from './portrait-config.js';
import { sheetFiles, frameAt, validateTimeline } from './animation-timeline.js';
import { emotionForRange, emotionSuggestion, restoreDetectedEmotions } from './emotion-analysis.js';
import { performanceTimeline } from './video-performance.js';

import { loadGeneratedSets } from './generated-sets.js';
import { wordActing, suggestedWordSequences, sequenceLabel } from './word-acting.js';
import { performanceCatalog } from './performance-catalog.js';
import { resolveTimelineArtwork } from './performance-matching.js';
import { createFrameSetStudio } from './studio-frame-sets.js';

export function createAnalysisStudio(host, video, { getContext, setLocked, changed, previewMount, controlsMount = previewMount }) {
  host.innerHTML = `<h2>Animation</h2><div class="actions"><button id="analyze-clip">Analyze recording</button></div>
    <p id="analysis-status" role="status">Record a phrase to begin.</p>
    
    <div id="analysis-content" hidden><div class="animation-comparison"><div><canvas id="animation-preview" width="320" height="320" aria-label="Animation synchronized with the recording"></canvas><p id="animation-caption"></p></div><div><button id="play-animation">Play preview</button><label>Your recorded words<textarea id="spoken-line" rows="2"></textarea></label></div></div>
    <p id="emotion-summary" class="note"></p>
    <label class="check"><input id="review-all" type="checkbox"> I’ve checked the animation and words</label>
    <div class="actions"><button id="save-timeline">Save draft</button><button id="approve-timeline">Use in game</button></div></div>
    <details id="advanced-animation"><summary>Advanced · timeline, analysis &amp; assets</summary>
    <details id="manual-frame-set"></details>
    <label class="check" hidden><input id="include-review-media" type="checkbox"> Include screenshots and sliced review clips when rebuilding analysis (slower)</label>
    <p class="note">Choose different emotions for individual sections below. Mouth motion follows audio loudness, not phonemes. Choose reusable gesture sets from the emotion library.</p>
    <p id="speech-state" class="note">Checking local speech…</p><p id="emotion-state" class="note">Checking local emotion model…</p>
    <div class="actions"><button id="analyze-emotions">Analyze vocal emotion</button><button id="reload-analysis">Reload saved draft</button></div>
    <details id="emotion-detail" hidden><summary>Vocal-emotion scores and missing frame sets</summary><p class="note">Scores are model estimates, not certainty. Sarcasm and context need your judgment.</p><div id="emotion-results"></div></details>
    <div class="actions"><button id="split-segment">Split at playhead</button><button id="export-review">Export review ZIP</button><button id="import-timeline">Import reviewed timeline</button><input id="timeline-file" type="file" accept=".json,application/json" hidden></div>
    <div class="timeline-scroll"><table><thead><tr><th>Time / seek</th><th>Animation</th><th>Mouth</th><th>Needs review / notes</th><th>Edit</th></tr></thead><tbody id="timeline-rows"></tbody></table></div>
    <details><summary>Extracted screenshots and slices</summary><div id="analysis-frames" class="analysis-frames"></div><div id="analysis-slices" class="actions"></div></details>
    <details><summary>Available animation frames</summary><div id="animation-catalog" class="animation-catalog"></div></details></details>`;
  previewMount.append(host.querySelector('.animation-comparison > div:first-child'));
  const previewStatus = document.createElement('p'); previewStatus.id = 'preview-status'; previewStatus.className = 'preview-status'; previewStatus.setAttribute('role', 'status'); previewStatus.setAttribute('aria-live', 'polite');
  previewMount.prepend(previewStatus);
  const quickPlay = document.createElement('button'); quickPlay.id = 'quick-preview'; quickPlay.textContent = 'Play preview'; quickPlay.disabled = true; previewMount.append(quickPlay);
  const processButton = host.querySelector('#analyze-clip');
  processButton.textContent = 'Sync lips';
  processButton.title = 'Prepare mouth timing and wording-based emotions locally. When Auto-create missing frames is enabled, missing artwork for this coach uses image-generation credit.';
  const processActions = document.createElement('div'); processActions.className = 'actions preview-process-actions';
  processActions.append(quickPlay, processButton); previewMount.append(processActions);
  const syncStatus = document.createElement('span'); syncStatus.className = 'sync-status note'; syncStatus.setAttribute('role', 'status'); syncStatus.setAttribute('aria-live', 'polite');
  processActions.append(syncStatus);
  const choices = document.createElement('div');
  choices.innerHTML = `<label>Change animation / emotion<select id="phrase-emotion" disabled><option value="mixed" disabled>Custom timeline (Advanced)</option></select></label><div id="emotion-actions" class="actions"><button id="use-detected-emotions" disabled>Use voice emotions</button><button id="use-word-acting" disabled title="Choose expressive acting from the words, without paid video analysis. Click again for another suitable variation.">Use wording</button></div><p id="emotion-help" class="note">Analyze the recording to choose an emotion.</p>`;
  controlsMount.append(choices);
  const quickChoices = document.createElement('div'); quickChoices.className = 'quick-animation-choices';
  quickChoices.append(choices.querySelector('label'));
  const saveActions = document.createElement('div'); saveActions.className = 'actions';
  host.querySelector('#save-timeline').textContent = 'Save';
  host.querySelector('#reload-analysis').hidden = true;
  host.querySelector('#approve-timeline').hidden = true;
  host.querySelector('#review-all').closest('label').hidden = true;
  saveActions.append(host.querySelector('#save-timeline'));
  const quickEditStatus = document.createElement('p'); quickEditStatus.className = 'note'; quickEditStatus.setAttribute('role', 'status');
  quickEditStatus.textContent = 'Choose a sequence or a single emotion, then Save to use it in game.';
  quickChoices.append(saveActions, quickEditStatus); previewMount.append(quickChoices);
  const artworkState = document.createElement('p'); artworkState.className = 'note'; artworkState.setAttribute('role', 'status'); artworkState.hidden = true;
  const reviewArtwork = document.createElement('button'); reviewArtwork.textContent = 'Review new frames'; reviewArtwork.hidden = true;
  reviewArtwork.onclick = () => {
    for (let parent = host.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    const target = pendingArtwork?.value === 'video-sequence' ? $('#generated-artwork') : $('#manual-frame-set');
    for (let parent = target; parent && parent !== host; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  quickChoices.append(artworkState, reviewArtwork);
  const artworkActions = document.createElement('div'); artworkActions.className = 'actions';
  const createArtwork = document.createElement('button'); createArtwork.textContent = 'Create missing frames · paid'; createArtwork.disabled = true;
  const autoArtworkLabel = document.createElement('label'); autoArtworkLabel.className = 'check';
  const autoArtwork = document.createElement('input'); autoArtwork.type = 'checkbox'; autoArtwork.id = 'auto-create-selected-art'; autoArtwork.checked = true;
  try { autoArtwork.checked = localStorage.getItem('studio-auto-create-selected-art') !== 'false'; } catch {}
  autoArtworkLabel.append(autoArtwork, document.createTextNode('Auto-create missing frames · paid'));
  artworkActions.append(createArtwork, autoArtworkLabel); quickChoices.insertBefore(artworkActions, artworkState);
  const $ = selector => host.querySelector(selector) || previewMount.querySelector(selector) || controlsMount.querySelector(selector);
  const suggestedSets = document.createElement('optgroup'); suggestedSets.label = 'Suggested from your words'; suggestedSets.hidden = true;
  const originalSets = document.createElement('optgroup'); originalSets.label = 'All illustrated emotions / frame sets';
  const dgxSets = document.createElement('optgroup'); dgxSets.label = 'DGX';
  for (const [name, preset] of Object.entries(portraitPresets)) {
    if (preset.columns) continue;
    const label = name === 'dgx-calm-pilot' ? 'Calm · DGX pilot' : name.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
    (name === 'dgx-calm-pilot' ? dgxSets : originalSets).append(new Option(label, name));
  }
  const videoSets = document.createElement('optgroup'); videoSets.label = 'Suggested from video'; videoSets.hidden = true;
  const plannedSets = document.createElement('optgroup'); plannedSets.label = 'New gestures · selecting creates missing artwork (paid)';
  for (const entry of performanceCatalog.filter(entry => entry.speaking && !entry.assets.length)) plannedSets.append(new Option(entry.label, `create:${entry.id}`));
  $('#phrase-emotion').append(suggestedSets, videoSets, originalSets, dgxSets, plannedSets);
  let contextKey = '', analysis = null, dirty = false, busy = false, savingDraft = false, available = true, generation = 0, animationFrame, polling = false, emotionReady = false;
  let videoPreview = null, timingPreview = null;
  let syncState = '', syncStage = '';
  let actingVariation = 0;
  let sequenceOptions = [], selectedSequence = '', suggestedVideo = null, pendingArtwork = null, checkingArtwork = false;
  let corePreviewImage = null;
  let artLibrary = [], currentReference = { id: 'original' }, libraryKnown = false, artworkRequestBusy = false;
  const videoStudio = { update() {}, async createMissing() {} };
  const sprites = Object.fromEntries(Object.entries(sheetFiles).map(([key, file]) => {
    const image = new Image(); image.src = sheetUrl(file); image.onload = draw; return [key, image];
  }));
  async function refreshGenerated() {
    await loadGeneratedSets();
    const response = await fetch('/api/recordings/frame-sets', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Could not check the coach reference and artwork library.');
    const result = await response.json(); artLibrary = result.assets; currentReference = result.reference; libraryKnown = true;
    if (currentReference.image && corePreviewImage?.getAttribute('src') !== currentReference.image) { corePreviewImage = new Image(); corePreviewImage.onload = draw; corePreviewImage.src = currentReference.image; }
    for (const [name, preset] of Object.entries(portraitPresets)) {
      if (!preset.image || sprites[preset.sheet] || !artLibrary.some(asset => asset.setId === name)) continue;
      const image = new Image(); image.onload = draw; image.src = preset.image; sprites[preset.sheet] = image;
      if (!preset.columns) originalSets.append(new Option(`${preset.label} · generated`, name));
    }
    refreshSequenceOptions();
  }
  refreshGenerated().catch(error => { artworkState.hidden = false; artworkState.textContent = error.message; });
  createFrameSetStudio($('#manual-frame-set'), { getToken: () => getContext().token, onLibraryChanged: async () => { await refreshGenerated(); showArtworkProgress(); updateControls(); } });
  let previewMessage = 'Record a take to prepare its animation';
  const message = text => { $('#analysis-status').textContent = text; quickEditStatus.textContent = text; };
  function previewState() {
    const ctx = getContext();
    const text = ctx.previewSaved === false ? 'Saving / recording · preview available after saving and processing' : !ctx.saved?.original ? 'Record a take to prepare its animation' : previewMessage;
    if (previewStatus.textContent !== text) previewStatus.textContent = text;
    previewStatus.classList.toggle('is-processing', !!ctx.saved?.original && (busy || !analysis) || ctx.previewSaved === false);
    $('#quick-preview').disabled = !available || !(analysis || timingPreview) || ctx.previewSaved === false;
  }
  function updateControls() {
    const ctx = getContext();
    $('#analyze-clip').disabled = !available || busy || dirty || !ctx.saved?.original || !ctx.token;
    const syncing = ['queued', 'running'].includes(syncState);
    $('#analyze-clip').textContent = syncState === 'queued' ? 'Sync lips · queued' : syncState === 'running' ? 'Syncing lips…' : analysis ? 'Re-sync lips' : 'Sync lips';
    $('#analyze-clip').classList.toggle('is-syncing', syncing);
    $('#analyze-clip').setAttribute('aria-busy', String(syncing));
    syncStatus.textContent = syncing ? syncStage : syncState === 'failed' ? 'Sync needs attention' : analysis ? 'Lip timing ready' : '';
    $('#analyze-emotions').disabled = !available || busy || dirty || !analysis || !ctx.token || !emotionReady;
    $('#reload-analysis').disabled = !available || busy || !ctx.saved?.original;
    for (const id of ['phrase-emotion', 'review-all', 'save-timeline', 'approve-timeline', 'import-timeline', 'split-segment', 'spoken-line']) $('#' + id).disabled = !available || busy || !analysis;
    $('#save-timeline').disabled ||= !!pendingArtwork || artworkRequirements().length > 0 || !$('#spoken-line').value.trim();
    $('#phrase-emotion').disabled ||= artworkRequestBusy;
    createArtwork.disabled = !available || busy || artworkRequestBusy || !analysis || !libraryKnown || !artworkRequirements().some(item => item.status === 'missing');
    createArtwork.textContent = artworkRequestBusy ? 'Queuing frames…' : 'Create missing frames · paid';
    $('#approve-timeline').disabled ||= !analysis?.timeline.every(segment => !segment.needsReview) || !$('#spoken-line').value.trim();
    $('#use-detected-emotions').disabled = !available || busy || !analysis || analysis.emotions?.status !== 'complete';
    $('#use-word-acting').disabled = !available || busy || !analysis;
    $('#use-detected-emotions').title = analysis?.emotions?.status === 'complete' ? 'Restore voice-based frame sets for each section' : 'Run vocal emotion analysis first';
    $('#export-review').disabled = !available || busy || dirty || !analysis;
    $('#play-animation').disabled = !available || !analysis;
    for (const input of $('#timeline-rows').querySelectorAll('input,select,textarea,button')) input.disabled = busy || !available;
    for (const button of $('#timeline-rows').querySelectorAll('.use-emotion')) button.disabled ||= button.dataset.usable !== 'true';
    setLocked(dirty || savingDraft);
    videoStudio.update();
    previewState();
  }
  function markDirty() { videoPreview = null; dirty = true; message('Unsaved animation changes. Save to use this performance in game.'); updateControls(); draw(); }
  async function request(operation, body) {
    const ctx = getContext();
    const response = await fetch(`/api/recordings/${ctx.id}/${operation}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': ctx.token }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  function draw() {
    previewMount.hidden = false;
    const context = getContext();
    const playback = analysis || timingPreview;
    const timed = playback && context.previewSaved !== false;
    const seconds = video.srcObject ? 0 : video.currentTime;
    const originalEmotion = phraseAnimations[context.id]?.emotion || 'calm';
    const frame = timed ? frameAt(videoPreview || playback.timeline, playback.envelope, seconds) : { emotion: originalEmotion, mouth: 0, elapsed: 0 };
    let preset = portraitPresets[frame.emotion] || portraitPresets.calm;
    if (currentReference.id !== 'original' || selectedCoach() !== 'jimmy') {
      const match = performanceCatalog.find(item => item.assets.includes(frame.emotion));
      const asset = artLibrary.find(item => item.status === 'approved' && item.referenceId === currentReference.id && item.performanceId === match?.id);
      if (asset) preset = portraitPresets[asset.setId] || preset;
      else if (!artLibrary.some(item => item.status === 'approved' && item.setId === frame.emotion)) {
        const canvas = $('#animation-preview'), ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (corePreviewImage?.complete && corePreviewImage.naturalWidth) ctx.drawImage(corePreviewImage, 0, 0, canvas.width, canvas.height);
        else { ctx.fillStyle = '#d7dfbe'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Add coach reference images below', canvas.width / 2, canvas.height / 2); }
        $('#animation-caption').textContent = currentReference.pending ? 'Approve core portraits below to create this coach’s emotion frames.' : 'Core portrait · create emotion frames to animate this coach.';
        return;
      }
    }
    const column = preset.columns ? (preset.columns[Math.floor(frame.elapsed / preset.step)] ?? preset.restingColumn) : video.ended || video.srcObject ? 0 : frame.mouth;
    const row = preset.gesture ? (preset.gesture[Math.floor(frame.elapsed / preset.step)] ?? preset.row) : preset.row;
    const image = sprites[preset.sheet];
    if (!image?.complete || !image.naturalWidth) return;
    const canvas = $('#animation-preview'), ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const width = image.naturalWidth / 3, height = image.naturalHeight / (preset.rows || 4);
    ctx.drawImage(image, column * width, row * height, width, height, 0, 0, canvas.width, canvas.height);
    const style = preset.image ? 'Coach artwork' : 'Original illustration';
    $('#animation-caption').textContent = timed ? `${seconds.toFixed(2)}s · Frame set: ${frame.emotion} · ${style} · ${videoPreview ? 'video suggestions · preview only' : video.srcObject ? 'draft preview' : 'audio timing'}` : `${frame.emotion} · ${style} · Preview artwork; audio timing available after saving and analysis`;
    if (analysis) for (const [index, row] of [...$('#timeline-rows').children].entries()) row.classList.toggle('active-segment', video.currentTime >= analysis.timeline[index].start && video.currentTime < analysis.timeline[index].end);
  }
  function tick() { cancelAnimationFrame(animationFrame); draw(); if (!video.paused && !video.ended) animationFrame = requestAnimationFrame(tick); }
  for (const event of ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata', 'ended']) video.addEventListener(event, tick);
  function refreshSequenceOptions() {
    if (!analysis) { suggestedSets.replaceChildren(); videoSets.replaceChildren(); return; }
    sequenceOptions = suggestedWordSequences(analysis.timeline, { phraseId: getContext().id, text: $('#spoken-line').value || analysis.spokenText || analysis.transcript.text });
    suggestedSets.replaceChildren(...sequenceOptions.map(option => new Option(`${option.label}${resolveTimelineArtwork(option.timeline, artLibrary, currentReference.id).requirements.length ? ' · artwork needed' : ''}`, option.id)));
    suggestedSets.hidden = false;
    videoSets.replaceChildren(); videoSets.hidden = !suggestedVideo;
    if (suggestedVideo) videoSets.append(new Option(`${sequenceLabel(suggestedVideo.segments)} · gestures${suggestedVideo.missingAssets.length ? ` · ${artworkSummary(suggestedVideo.missingAssets)}` : ''}`, 'video-sequence'));
    const emotions = new Set(analysis.timeline.map(segment => segment.emotion));
    const matches = sequenceOptions.find(option => option.timeline.every((part, index) => part.emotion === analysis.timeline[index]?.emotion));
    $('#phrase-emotion').querySelector('option[value="mixed"]').textContent = `${sequenceLabel(analysis.timeline.map(segment => ({ emotion: portraitPresets[segment.emotion]?.label || segment.emotion })))} · current sequence`;
    $('#phrase-emotion').value = pendingArtwork ? pendingArtwork.value : selectedSequence === 'video-sequence' && suggestedVideo ? selectedSequence : matches?.id || (emotions.size === 1 ? [...emotions][0] : 'mixed');
  }
  function renderRows() {
    refreshSequenceOptions();
    $('#review-all').checked = analysis.timeline.every(segment => !segment.needsReview);
    $('#timeline-rows').replaceChildren();
    analysis.timeline.forEach((segment, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td><button class="seek"></button><label>End (seconds)<input class="end" type="number" min="0" step="0.01"></label></td><td><select class="emotion" aria-label="Animation"></select><p class="voice-emotion note"></p><button class="use-emotion">Use voice suggestion</button></td><td><select class="mouth" aria-label="Mouth"><option value="auto">Audio timing</option><option value="0">Closed</option><option value="1">Partly open</option><option value="2">Open</option></select></td><td><label class="check"><input class="review" type="checkbox"> Needs review</label><textarea class="note-text" rows="2" aria-label="Review notes"></textarea><p class="segment-words"></p></td><td><button class="merge">Merge next</button></td>`;
      const find = selector => row.querySelector(selector);
      find('.seek').textContent = `${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s`;
      find('.seek').onclick = () => { video.currentTime = segment.start; draw(); };
      find('.end').value = segment.end;
      find('.end').onchange = event => {
        const end = Number(event.target.value), next = analysis.timeline[index + 1];
        if (!Number.isFinite(end) || end <= segment.start || (next ? end >= next.end : end !== analysis.duration)) { event.target.value = segment.end; message('End must stay inside this and the next segment; the final end is the clip duration.'); return; }
        segment.end = end; segment.needsReview = true; if (next) { next.start = end; next.needsReview = true; } markDirty(); renderRows();
      };
      for (const emotion of Object.keys(portraitPresets)) find('.emotion').add(new Option(emotion, emotion));
      find('.emotion').value = segment.emotion; find('.mouth').value = String(segment.mouth);
      const evidence = emotionForRange(analysis.emotions, segment.start, segment.end);
      const suggestion = emotionSuggestion(evidence, segment.emotion);
      find('.voice-emotion').textContent = evidence ? `Voice ${evidence.start.toFixed(1)}–${evidence.end.toFixed(1)}s: ${suggestion.label} · model score ${(suggestion.score * 100).toFixed(0)}%. ${suggestion.reason}` : 'Vocal emotion has not been analyzed for this section.';
      find('.use-emotion').hidden = !evidence;
      find('.use-emotion').dataset.usable = String(!!suggestion.suggestedEmotion);
      find('.use-emotion').onclick = () => {
        if (!suggestion.suggestedEmotion) return;
        segment.emotion = suggestion.suggestedEmotion; segment.needsReview = true;
        segment.note = `${segment.note} ${suggestion.reason} Review against the recording.`.trim();
        markDirty(); renderRows();
      };
      find('.emotion').onchange = event => { segment.emotion = event.target.value; segment.needsReview = true; markDirty(); renderRows(); };
      find('.mouth').onchange = event => { segment.mouth = event.target.value === 'auto' ? 'auto' : Number(event.target.value); segment.needsReview = true; markDirty(); renderRows(); };
      find('.review').checked = segment.needsReview;
      find('.review').onchange = event => { segment.needsReview = event.target.checked; markDirty(); renderRows(); };
      find('.note-text').value = segment.note;
      find('.note-text').oninput = event => { segment.note = event.target.value; markDirty(); };
      find('.segment-words').textContent = segment.text;
      find('.merge').hidden = index === analysis.timeline.length - 1;
      find('.merge').onclick = () => { const next = analysis.timeline[index + 1]; segment.end = next.end; segment.text += ' ' + next.text; segment.note += ' ' + next.note; segment.needsReview = true; analysis.timeline.splice(index + 1, 1); markDirty(); renderRows(); };
      $('#timeline-rows').append(row);
    });
    updateControls(); draw();
  }
  function render() {
    $('#analysis-content').hidden = !analysis;
    $('#emotion-help').textContent = analysis ? 'Use wording adds expressive acting without video analysis; click again for variety. Voice emotions follow your delivery. Save keeps your edits and applies them in game.' : 'Sync lips to prepare this recording.';
    previewMount.hidden = false;
    if (!analysis) {
      suggestedSets.replaceChildren(); suggestedSets.hidden = true;
      for (const id of ['timeline-rows', 'analysis-frames', 'analysis-slices', 'emotion-results']) $('#' + id).replaceChildren();
      $('#emotion-detail').hidden = true;
      $('#phrase-emotion').value = phraseAnimations[getContext().id]?.emotion || 'calm';
      updateControls(); draw(); return;
    }
    $('#spoken-line').value = analysis.spokenText ?? analysis.transcript.text;
    const emotions = analysis.emotions;
    const detected = [...new Set((emotions?.segments || []).filter(segment => segment.status === 'estimated').map(segment => segment.label === '<unk>' ? 'uncertain' : segment.label))];
    $('#emotion-summary').textContent = emotions?.status === 'complete'
      ? `Voice estimate: ${detected.join(', ') || 'uncertain'}. You can choose any emotion above.`
      : emotions?.status === 'failed' ? 'Voice analysis failed. You can still choose an emotion; retry under Advanced.'
      : 'Acting uses the words. Vocal-emotion analysis is optional under Advanced.';
    $('#emotion-detail').hidden = emotions?.status !== 'complete';
    $('#emotion-results').replaceChildren(...(emotions?.segments ?? []).map(segment => {
      const item = document.createElement('p'); item.className = 'note';
      const scores = Object.entries(segment.scores ?? {}).sort((a, b) => b[1] - a[1]).map(([label, score]) => `${label}: ${(score * 100).toFixed(1)}%`).join(' · ');
      const suggestion = emotionSuggestion(segment);
      item.textContent = `${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s (audio context ${segment.contextStart?.toFixed(2) ?? segment.start}–${segment.contextEnd?.toFixed(2) ?? segment.end}s): ${scores || suggestion.reason}${suggestion.missingAsset ? ' Missing set: ' + suggestion.missingAsset + '.' : ''}`;
      return item;
    }));
    renderRows();
    $('#analysis-frames').replaceChildren(...analysis.frames.map(frame => {
      const button = document.createElement('button'), image = new Image(); image.src = frame.image; image.alt = `Recording at ${frame.at} seconds`; image.loading = 'lazy';
      button.append(image, document.createTextNode(`${frame.at}s`)); button.onclick = () => { video.currentTime = frame.at; }; return button;
    }));
    $('#analysis-slices').replaceChildren(...analysis.slices.map(slice => {
      const link = document.createElement('a'); link.href = slice.video; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `Clip ${slice.start.toFixed(1)}–${slice.end.toFixed(1)}s`; return link;
    }));
  }
  async function load() {
    if (dirty || savingDraft || polling || !getContext().saved?.original) return;
    const version = generation; polling = true;
    try {
      const result = await request('analysis');
      if (version !== generation || dirty) return;
      busy = ['queued', 'running'].includes(result.job?.status);
      const syncJob = result.job?.operation === 'analyze';
      syncState = syncJob && busy ? result.job.status : syncJob && ['failed', 'interrupted', 'superseded'].includes(result.job.status) ? 'failed' : '';
      syncStage = syncJob ? result.job.stage : '';
      timingPreview = result.preview?.source === getContext().saved.original ? result.preview : null;
      if (result.analysis?.revision !== analysis?.revision) {
        await refreshGenerated();
        if (version !== generation || dirty) return;
        analysis = result.analysis; render();
      }
      const failed = ['failed', 'interrupted', 'superseded'].includes(result.job?.status);
      previewMessage = busy ? `${timingPreview ? 'Mouth-timed preview ready · ' : ''}${result.job.status === 'queued' ? 'Queued' : 'Processing'} · ${result.job.stage}${timingPreview && !analysis ? ' · final acting still preparing' : ''}` : failed ? `Needs attention · ${result.job.stage}` : analysis ? 'Ready · play preview or keep recording' : 'Animation not prepared · choose Sync lips';
      message(busy ? result.job.stage : failed ? result.job.stage : analysis ? `${getContext().saved?.animation?.automatic && getContext().saved.animation.analysisId === analysis.id ? 'Automatic animation ready in game' : analysis.status === 'approved' ? 'Saved for game' : 'Animation draft ready'} · adjustments optional.${!analysis.transcript.text ? ' No speech recognized; you can enter the words below.' : ''}` : 'Ready to analyze this take.');
      updateControls();
      draw();
    } catch (error) { if (version === generation) { busy = false; syncState = ''; syncStage = ''; previewMessage = `Needs attention · ${error.message}`; message(error.message); updateControls(); } }
    finally { polling = false; }
  }
  $('#analyze-clip').onclick = async () => {
    if ($('#analyze-clip').disabled) return;
    const version = generation;
    syncState = 'queued'; syncStage = 'Waiting to start';
    previewMessage = 'Queued · preparing speech timing and animation';
    busy = true; updateControls();
    try { const result = await request('analyze', { source: getContext().saved.original, useAutomatically: getContext().useAutomatically === true, autoCreateArtwork: autoArtwork.checked, reviewMedia: $('#include-review-media').checked }); if (version === generation) message(result.job.stage); }
    catch (error) { if (version === generation) { busy = false; syncState = 'failed'; previewMessage = `Needs attention · ${error.message}`; message(error.message); updateControls(); } }
  };
  $('#reload-analysis').onclick = () => { if (dirty && !confirm('Discard unsaved timeline edits and reload?')) return; dirty = false; analysis = null; render(); load(); };
  $('#analyze-emotions').onclick = async () => {
    const version = generation;
    busy = true; updateControls();
    try { const result = await request('emotions', { source: analysis.source, analysisId: analysis.id, revision: analysis.revision }); if (version === generation) message(result.job.stage); }
    catch (error) { if (version === generation) { busy = false; message(error.message); updateControls(); } }
  };
  $('#spoken-line').oninput = () => {
    analysis.spokenText = $('#spoken-line').value;
    analysis.timeline.forEach(segment => { segment.needsReview = true; });
    markDirty(); renderRows();
  };
  $('#phrase-emotion').onchange = async () => {
    if (!available || busy || !analysis || artworkRequestBusy) return;
    const emotion = $('#phrase-emotion').value;
    pendingArtwork = null; artworkState.hidden = true; reviewArtwork.hidden = true; selectedSequence = '';
    const sequence = sequenceOptions.find(option => option.id === emotion);
    if (emotion === 'video-sequence' && suggestedVideo) {
      if (suggestedVideo.missingAssets.length) {
        pendingArtwork = { value: emotion, referenceId: currentReference.id }; showArtworkProgress(); updateControls();
        if (autoArtwork.checked) await createMissingArtwork(); return;
      }
      analysis.timeline = performanceTimeline(suggestedVideo, analysis);
      selectedSequence = emotion; markDirty(); renderRows(); return;
    }
    if (!sequence && !emotion.startsWith('create:') && (!Object.hasOwn(portraitPresets, emotion) || portraitPresets[emotion].columns)) return;
    const timeline = sequence?.timeline || analysis.timeline.map(segment => emotion.startsWith('create:') ? { ...segment, artworkPerformance: emotion.slice(7) } : { ...segment, emotion, mouth: 'auto', needsReview: true });
    await selectTimelineArtwork(emotion, timeline);
  };
  async function selectTimelineArtwork(value, timeline) {
    const version = generation;
    const selection = { value, timeline, referenceId: currentReference.id };
    pendingArtwork = selection;
    try {
      await refreshGenerated();
      if (version !== generation || pendingArtwork !== selection) return;
      const resolved = resolveTimelineArtwork(timeline, artLibrary, currentReference.id);
      if (!resolved.requirements.length) {
        pendingArtwork = null; analysis.timeline = resolved.timeline; selectedSequence = value; markDirty(); renderRows(); return;
      }
      pendingArtwork = { value, timeline, referenceId: currentReference.id }; showArtworkProgress(); refreshSequenceOptions(); updateControls();
      if (autoArtwork.checked) await createMissingArtwork();
    } catch (error) { if (version === generation) { artworkState.hidden = false; artworkState.textContent = error.message; } }
  }
  function artworkRequirements() {
    if (!analysis || !libraryKnown) return [];
    return pendingArtwork?.value === 'video-sequence' ? suggestedVideo?.missingAssets || [] : resolveTimelineArtwork(pendingArtwork?.timeline || analysis.timeline, artLibrary, currentReference.id).requirements;
  }
  function artworkSummary(records) {
    const counts = {};
    for (const item of records) { const label = { draft: 'ready to review', missing: 'missing', queued: 'queued', generating: 'generating', 'needs-review': 'needs a match', failed: 'failed', interrupted: 'interrupted' }[item.status] || item.status; counts[label] = (counts[label] || 0) + 1; }
    return Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(' · ');
  }
  function showArtworkProgress() {
    const requirements = artworkRequirements();
    artworkState.hidden = !requirements.length; reviewArtwork.hidden = !requirements.some(item => ['draft', 'needs-review', 'failed', 'interrupted'].includes(item.status));
    artworkState.textContent = requirements.length ? `Frames: ${artworkSummary(requirements)}.${requirements.some(item => item.status === 'draft') ? ' Review new frames to add them to the library.' : ''}${requirements.some(item => item.status === 'missing') ? ' Create missing frames prepares the selected sequence.' : ''}` : '';
    const errors = requirements.map(item => item.record?.error).filter(Boolean);
    if (errors.length) artworkState.textContent += ` ${[...new Set(errors)].join(' ')}`;
  }
  async function createMissingArtwork() {
    if (artworkRequestBusy || !available || busy || !analysis) return;
    if (!pendingArtwork) pendingArtwork = { value: $('#phrase-emotion').value, timeline: analysis.timeline.map(segment => ({ ...segment })), referenceId: currentReference.id };
    const pending = pendingArtwork, version = generation;
    const ids = artworkRequirements().filter(item => item.status === 'missing').map(item => item.key);
    if (!ids.length) { showArtworkProgress(); updateControls(); return; }
    artworkRequestBusy = true; artworkState.hidden = false; artworkState.textContent = `Queuing ${ids.length} missing frame sets…`; updateControls();
    try {
      if (pending.value === 'video-sequence') await videoStudio.createMissing(true);
      else {
        const response = await fetch('/api/recordings/frame-sets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': getContext().token }, body: JSON.stringify({ performanceIds: ids, referenceId: pending.referenceId }), signal: AbortSignal.timeout(15000) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not queue artwork.');
      }
      if (version === generation && pending === pendingArtwork) { await refreshGenerated(); showArtworkProgress(); }
    } catch (error) { if (version === generation && pending === pendingArtwork) { artworkState.hidden = false; artworkState.textContent = error.message; } }
    finally { artworkRequestBusy = false; updateControls(); }
  }
  createArtwork.onclick = createMissingArtwork;
  autoArtwork.onchange = () => { try { localStorage.setItem('studio-auto-create-selected-art', String(autoArtwork.checked)); } catch {} if (autoArtwork.checked) createMissingArtwork(); };
  async function checkPendingArtwork() {
    if (checkingArtwork || artworkRequestBusy || document.hidden || !analysis) return;
    if (!pendingArtwork && artworkRequirements().length) pendingArtwork = { value: $('#phrase-emotion').value, timeline: analysis.timeline.map(segment => ({ ...segment })), referenceId: currentReference.id };
    if (!pendingArtwork) return;
    const pending = pendingArtwork, version = generation; checkingArtwork = true;
    try {
      await refreshGenerated();
      if (version !== generation || pending !== pendingArtwork) return;
      if (pending.referenceId !== currentReference.id) { pendingArtwork = null; artworkState.hidden = false; artworkState.textContent = 'Coach reference changed. Select the sequence again to prepare its new frames.'; updateControls(); return; }
      const requirements = artworkRequirements();
      if (!requirements.length && available && !busy && (pending.value !== 'video-sequence' || suggestedVideo)) {
        analysis.timeline = pending.value === 'video-sequence' ? performanceTimeline(suggestedVideo, analysis) : resolveTimelineArtwork(pending.timeline, artLibrary, currentReference.id).timeline;
        selectedSequence = pending.value; pendingArtwork = null;
        artworkState.hidden = false;
        artworkState.textContent = 'New frames ready and selected. Preview, then Save.'; reviewArtwork.hidden = true;
        markDirty(); renderRows();
      } else {
        showArtworkProgress(); updateControls();
      }
    } catch (error) { if (version === generation && pending === pendingArtwork) artworkState.textContent = error.message; }
    finally { checkingArtwork = false; }
  }
  setInterval(checkPendingArtwork, 2500);
  $('#review-all').onchange = () => {
    if (!available || busy || !analysis) return;
    const reviewed = $('#review-all').checked;
    analysis.timeline.forEach(segment => { segment.needsReview = !reviewed; });
    markDirty(); renderRows();
    message(reviewed ? 'Checked. Use in game to save this performance.' : 'Review the preview and words before using in game.');
  };
  $('#use-detected-emotions').onclick = () => {
    if (!available || busy || !analysis || analysis.emotions?.status !== 'complete') return;
    const restored = restoreDetectedEmotions(analysis.timeline, analysis.emotions, phraseAnimations[getContext().id]?.emotion || 'calm');
    try { validateTimeline(restored.timeline, analysis.duration); }
    catch (error) { message(error.message); return; }
    analysis.timeline = restored.timeline;
    markDirty(); renderRows();
    message(`Detected emotions applied to ${restored.matched} sections.${restored.fallback ? ` ${restored.fallback} uncertain or unmatched sections use the phrase’s default expression.` : ''} Preview and review before using in game.`);
  };
  $('#use-word-acting').onclick = () => {
    if (!available || busy || !analysis) return;
    analysis.timeline = wordActing(analysis.timeline, { phraseId: getContext().id, text: $('#spoken-line').value, variation: actingVariation++ });
    markDirty(); renderRows();
    message('Wording-based acting applied using existing artwork. Click again for variety, or preview and save. No paid analysis needed.');
  };
  function playPreview() {
    const playback = analysis || timingPreview; if (!playback) return;
    video.srcObject = null;
    if (video.getAttribute('src') !== playback.source) video.src = playback.source;
    video.muted = false; video.controls = true; video.classList.remove('live-preview', 'styled-preview');
    if (video.ended) video.currentTime = 0;
    video.play().catch(error => message(error.message));
  }
  $('#play-animation').onclick = playPreview;
  $('#quick-preview').onclick = () => {
    if ($('#quick-preview').disabled) return;
    playPreview();
  };
  $('#split-segment').onclick = () => {
    const at = video.currentTime, index = analysis.timeline.findIndex(segment => at > segment.start + 0.05 && at < segment.end - 0.05);
    if (index < 0) return message('Seek inside a segment before splitting.');
    const segment = analysis.timeline[index]; analysis.timeline.splice(index + 1, 0, { ...segment, start: at }); segment.end = at; markDirty(); renderRows();
  };
  async function save(approve) {
    busy = true; savingDraft = true; updateControls();
    try {
      validateTimeline(analysis.timeline, analysis.duration);
      const result = await request('timeline', { source: analysis.source, analysisId: analysis.id, revision: analysis.revision, timeline: analysis.timeline, spokenText: $('#spoken-line').value, approve });
      analysis = result.analysis; dirty = false; render(); message(approve ? 'Saved. The game will use this animation and spoken line.' : 'Changes saved.'); changed();
      return true;
    } catch (error) { message(error.message); return false; }
    finally { busy = false; savingDraft = false; updateControls(); }
  }
  $('#save-timeline').onclick = async () => {
    if ($('#save-timeline').disabled || !analysis) return;
    const previous = analysis.timeline;
    analysis.timeline = previous.map(segment => ({ ...segment, needsReview: false }));
    if (!await save(true)) { analysis.timeline = previous; renderRows(); }
  };
  $('#approve-timeline').onclick = () => save(true);
  $('#export-review').onclick = () => { const link = document.createElement('a'); link.href = `/api/recordings/${getContext().id}/review-export`; link.download = ''; link.click(); };
  $('#import-timeline').onclick = () => $('#timeline-file').click();
  $('#timeline-file').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Timeline JSON is too large.');
      const imported = JSON.parse(await file.text());
      if (imported.analysisId !== analysis.id || imported.source !== analysis.source || imported.revision !== analysis.revision) throw new Error('This timeline belongs to a different take or revision. Export the current draft for review.');
      analysis.timeline = validateTimeline(imported.timeline, analysis.duration);
      if (typeof imported.spokenText === 'string') analysis.spokenText = imported.spokenText;
      markDirty(); render(); message('Imported for preview. Save a draft or approve when ready.');
    } catch (error) { message(error.message); }
  };
  for (const [emotion, preset] of Object.entries(portraitPresets)) {
    const card = document.createElement('div'), label = document.createElement('p'); label.textContent = emotion;
    const frames = document.createElement('div'); frames.className = 'catalog-frames';
    for (let row = 0; row < (preset.rows || 4); row++) {
      if (!preset.gesture && row !== preset.row) continue;
      for (let column = 0; column < 3; column++) {
        const thumb = document.createElement('div'); thumb.className = 'catalog-frame'; thumb.title = `${emotion}: row ${row}, column ${column}`;
        const rows = preset.rows || 4;
        thumb.style.backgroundImage = `url("${sheetUrl(sheetFiles[preset.sheet])}")`; thumb.style.backgroundSize = `300% ${rows * 100}%`; thumb.style.backgroundPosition = `${column * 50}% ${rows > 1 ? row * 100 / (rows - 1) : 0}%`; frames.append(thumb);
      }
    }
    card.append(label, frames); $('#animation-catalog').append(card);
  }
  fetch('/api/recordings/speech-status').then(response => response.json()).then(result => { $('#speech-state').textContent = result.ready ? 'Local speech ready · Faster Whisper base.en · CPU' : result.message; }).catch(() => { $('#speech-state').textContent = 'Start npm run dev to use local analysis.'; });
  async function checkEmotion() {
    try {
      const result = await (await fetch('/api/recordings/emotion-status')).json(); emotionReady = result.ready;
      $('#emotion-state').textContent = result.ready ? 'Local vocal emotion ready · emotion2vec+ large · GPU when available, CPU fallback' : result.message;
    } catch { emotionReady = false; $('#emotion-state').textContent = 'Local emotion status unavailable.'; }
    updateControls();
  }
  checkEmotion(); setInterval(checkEmotion, 15000);
  setInterval(() => { if (!document.hidden && !dirty) load(); }, 2000);
  return {
    refreshArtwork: refreshGenerated,
    select() {
      const ctx = getContext(), key = `${ctx.id}:${ctx.saved?.original || ''}`;
      if (key === contextKey) return;
      generation++; contextKey = key; analysis = null; videoPreview = null; timingPreview = null; dirty = false; busy = false; syncState = ''; syncStage = ''; selectedSequence = ''; pendingArtwork = null; suggestedVideo = null; artworkState.hidden = true; reviewArtwork.hidden = true; previewMessage = 'Checking processing status…'; render(); message('Loading analysis…'); load();
    },
    available(value) { if (available !== value) { available = value; updateControls(); draw(); } },
  };
}
