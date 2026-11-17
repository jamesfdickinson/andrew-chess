import { createCoachSettings } from './studio-coaches.js';
import { recordedPerformance } from './recorded-performance.js';
import { createVoiceStudio } from './studio-voice.js';
import { coachFetch as fetch, selectedCoach } from './coach-session.js';
import { recordingPhrases } from './recording-phrases.js';
import './studio.css';
import { createAnalysisStudio } from './studio-analysis.js';
import { beginDraft, appendDraft, listDrafts, removeDraft } from './studio-drafts.js';

const $ = selector => document.querySelector(selector);
$('#studio').innerHTML = `
<header><a href="/">← Andrew-Chess</a><div class="recorder-heading"><h1 id="studio-heading">Coach studio</h1><p id="progress"></p></div><div id="active-coach-control"></div></header>
<div id="analysis-activity" class="analysis-activity" role="status" aria-live="polite" hidden></div>
<main><aside><details id="phrase-picker" open><summary>Choose a phrase <span id="selected-phrase-label"></span></summary><details class="phrase-filters"><summary>Find a phrase</summary><label>Search<input id="search" type="search" placeholder="Words, name, or event"></label><label class="check"><input id="saved-only" type="checkbox"> Only recorded</label><label>Group<select id="group"><option value="">All phrases</option></select></label><label class="check"><input id="remaining" type="checkbox"> Only unrecorded</label></details><label>Phrase<select id="phrase" size="12"></select></label></details></aside>
<section><div class="script"><p id="category"></p><p id="line"></p></div>
<div class="actions recording-actions"><div class="record-control" role="group" aria-label="Microphone recorder"><span class="recorder-label">Record microphone</span><div class="recorder-buttons"><button id="record" disabled aria-label="Record microphone">● Record</button><button id="stop" disabled aria-label="Stop recording and save">■ Stop</button></div><span id="recording-indicator" hidden role="status" aria-live="polite"><span class="recording-dot" aria-hidden="true"></span>Recording <span id="recording-elapsed" aria-live="off">0:00</span></span></div><button id="next">Next unrecorded →</button><button id="upload-video">Upload audio</button></div>
<p id="status" role="status" aria-live="polite">Loading…</p><p id="editing-lock" class="note" hidden>Animation edits are unsaved. Use Save below to keep them and continue recording.</p>
<div class="studio-previews"><div class="audio-preview"><audio id="preview" controls></audio><span id="timer">Microphone off</span></div><div id="linked-animation" hidden></div></div>
<div id="voice-studio"></div><label class="check"><input id="auto-next" type="checkbox" checked> Move to next after saving</label>
<p class="note">Use your own words. Acting and mouth timing are prepared in the background; you can adjust them later.</p>
<details id="take-tools" class="studio-section"><summary>Trim & loop this take</summary>
<div class="actions"><label class="check"><input id="loop" type="checkbox"> Loop</label></div><details id="editor" hidden><summary>Edit clip · trim</summary><p class="note">Set start and end in seconds. Source files are kept.</p><div class="devices"><label>Start<input id="trim-start" type="number" min="0" step="0.01" value="0"></label><button id="mark-start">Use playhead</button><label>End<input id="trim-end" type="number" min="0" step="0.01"></label><button id="mark-end">Use playhead</button></div><div class="actions"><button id="preview-trim">Preview trim</button><button id="save-trim">Save trim</button></div></details></details>
<details class="studio-section"><summary>Recording options</summary><div class="actions"><label class="check"><input id="auto-analyze" type="checkbox" checked> Automatically prepare animation after recording</label><label class="check"><input id="auto-use-animation" type="checkbox" checked> Use automatic animation in game</label></div><p class="note">Speech and mouth timing run locally. Auto-create missing frames uses image-generation credit when the selected coach needs new artwork. Keep the local server running while clips process.</p><div class="actions"><input id="upload-file" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" hidden></div><details class="device-settings"><summary>Microphone settings</summary><div class="devices"><label>Microphone<select id="microphone"></select></label><button id="enable">Enable microphone</button></div></details></details>
<div class="actions"><button id="retry" hidden>Retry save</button><a id="download" hidden>Download</a><button id="reset-take" hidden>Keep backup & reset</button></div><details id="recovery" hidden><summary>Recover unsaved takes</summary><p class="note">These takes are saved in this browser. Recover one, then Retry save. A take interrupted by closing the page may be incomplete.</p><div id="recovery-list" class="actions"></div></details>

<details id="animation-settings" class="studio-section"><summary>Adjust animation · optional</summary><div id="animation-controls"></div><div id="animation-studio"></div></details><section id="coach-settings" class="studio-section"></section></section></main>`;
let recordings = {}, token, selectedId, stream, recorder, blob, blobUrl, recordingId;
let analysisJobs = [], jobsRefreshing = false;

let draftId = null, draftWrites = [], draftBackedUp = false;
let trimPreview = false;
let analysisLocked = false;
let saving = false, recording = false, starting = false, microphoneStarting = false, unsaved = false, elapsedTimer, limitTimer;
const status = text => { $('#status').textContent = text; };
const current = () => recordingPhrases.find(item => item.id === selectedId);
const filtered = () => recordingPhrases.filter(item => [item.id, item.text, item.group, item.event].join(' ').toLowerCase().includes($('#search').value.trim().toLowerCase()) && (!$('#saved-only').checked || recordings[item.id]) && (!$('#group').value || item.group === $('#group').value) && (!$('#remaining').checked || !recordings[item.id] || item.id === selectedId));
const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const narrowStudio = matchMedia('(max-width: 700px)');
$('#phrase-picker').open = !narrowStudio.matches;
for (const id of ['auto-next', 'auto-analyze', 'auto-use-animation']) {
  try { $('#' + id).checked = localStorage.getItem(`studio-${id}`) !== 'false'; } catch {}
  $('#' + id).onchange = () => { try { localStorage.setItem(`studio-${id}`, String($('#' + id).checked)); } catch {} controls(); };
}
const analysisStudio = createAnalysisStudio($('#animation-studio'), $('#preview'), {
  getContext: () => ({ id: selectedId, saved: recordings[selectedId], token, previewSaved: !unsaved && !recording, useAutomatically: $('#auto-use-animation').checked }),
  setLocked(value) { if (analysisLocked !== value) { analysisLocked = value; controls(); } },
  changed: () => refreshRecordings(),
  previewMount: $('#linked-animation'),
  controlsMount: $('#animation-controls'),
});
let voiceStudio;
const coachSettings = createCoachSettings($('#coach-settings'), { getToken: () => token, onBusyChanged: controls, isLocked: () => recording || saving || starting || unsaved || analysisLocked || voiceStudio?.locked(), onReferenceChanged: () => analysisStudio.refreshArtwork() });
voiceStudio = createVoiceStudio($('#voice-studio'), { getContext: () => ({ phrase: current(), saved: recordings[selectedId], token, locked: recording || saving || starting || unsaved || analysisLocked || coachSettings.locked() }), changed: refreshRecordings, onBusyChanged: controls });
function controls() {
  const busy = recording || saving || starting || microphoneStarting || analysisLocked || coachSettings.locked() || voiceStudio?.locked();
  voiceStudio?.update();
  analysisStudio.available(!(recording || saving || starting || microphoneStarting || unsaved));
  $('#record').disabled = !supported || !current() || busy || unsaved || !token;
  $('#stop').disabled = !recording;
  $('#coach-select').disabled = busy || unsaved;
  $('#recording-indicator').hidden = !recording;
  $('#record').textContent = '● Record';
  $('#record').classList.toggle('is-recording', recording);
  document.title = recording ? '● Recording — Coach studio' : 'Coach studio';
  $('#stop').title = $('#auto-next').checked ? 'Stop, save & move to the next phrase' : 'Stop & save this take';
  $('#upload-video').disabled = busy || unsaved || !current() || !token;
  $('#next').disabled = busy || unsaved;
  
  for (const selector of ['#search', '#saved-only', '#group', '#remaining', '#phrase', '#microphone', '#auto-analyze', '#auto-next', '#auto-use-animation']) $(selector).disabled = busy || unsaved;
  $('#auto-use-animation').disabled ||= !$('#auto-analyze').checked;
  $('#enable').disabled = busy || !supported;
  $('#retry').hidden = !unsaved || saving;
  $('#reset-take').hidden = !unsaved || saving || recording || !draftBackedUp;
  $('#editing-lock').hidden = !analysisLocked;
  for (const button of $('#recovery-list').querySelectorAll('button')) button.disabled = busy || unsaved;
  const saved = recordings[selectedId];
  $('#take-tools').hidden = !saved;
  $('#editor').hidden = !saved?.original;
  for (const id of ['trim-start', 'trim-end', 'mark-start', 'mark-end', 'preview-trim', 'save-trim']) $('#' + id).disabled = busy || unsaved;

}
function list() {
  $('#progress').textContent = `${recordingPhrases.filter(item => recordings[item.id]).length} / ${recordingPhrases.length} recorded`;
  $('#phrase').replaceChildren(...filtered().map(item => {
    const job = analysisJobs.find(job => job.phraseId === item.id);
    const label = { queued: ' · Queued', running: ' · Analyzing…', failed: ' · Analysis failed', interrupted: ' · Analysis interrupted' }[job?.status] || '';
    return new Option(`${recordings[item.id] ? '✓ ' : ''}${item.id}${label}`, item.id);
  }));
  $('#phrase').value = selectedId ?? '';
}
function clearTake() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null; blob = null;
  $('#download').hidden = true;
}
function live() {
  $('#preview').classList.add('live-preview');
  $('#preview').classList.remove('styled-preview');
  $('#preview').pause(); $('#preview').removeAttribute('src');
  $('#preview').srcObject = stream; $('#preview').muted = true; $('#preview').controls = false;
  // Never monitor the microphone through speakers.
}
function select(id) {
  clearTake(); selectedId = id; trimPreview = false; $('#editor').open = false; $('#take-tools').open = false; $('#animation-settings').open = false;
  const phrase = current();
  $('#category').textContent = phrase ? `${phrase.group} / ${phrase.event}` : 'All done';
  $('#line').textContent = phrase?.text ?? 'No matching phrases. Try another search or filter.';
  $('#selected-phrase-label').textContent = phrase ? `· ${phrase.id}` : '';
  if (phrase && recordings[id]) showSaved();
  else { live(); $('#timer').textContent = stream ? 'Ready' : 'Microphone off'; }
  list(); controls();
  voiceStudio?.select();
  analysisStudio.select();
  voiceStudio?.select();
}
function showSaved(art = false) {
  const saved = recordings[selectedId];
  const source = art ? saved?.variants?.pixelArt80?.video : recordedPerformance(saved).video;
  if (!source) return;
  trimPreview = false;
  $('#preview').classList.remove('live-preview');
  $('#preview').classList.toggle('styled-preview', art);
  $('#preview').srcObject = null; $('#preview').src = source;
  $('#preview').muted = false; $('#preview').controls = true; $('#preview').autoplay = false;
  $('#timer').textContent = art ? 'Pixel art' : 'Original recording';
  analysisStudio.select();
  voiceStudio?.select();
}
async function refreshDrafts() {
  try {
    const drafts = await listDrafts(); $('#recovery-list').replaceChildren();
    for (const draft of drafts) {
      if ((draft.coachId || 'jimmy') !== selectedCoach() || !recordingPhrases.some(phrase => phrase.id === draft.phraseId)) continue;
      const button = document.createElement('button');
      button.textContent = `${draft.phraseId} · ${new Date(draft.createdAt).toLocaleTimeString()} · ${(draft.blob.size / 1024).toFixed(0)} KB`;
      button.onclick = () => {
        if (recording || saving || unsaved || analysisLocked) return;
        select(draft.phraseId); draftId = draft.id; draftBackedUp = true; recordingId = draft.phraseId; blob = draft.blob; unsaved = true;
        blobUrl = URL.createObjectURL(blob); $('#preview').srcObject = null; $('#preview').src = blobUrl;
        $('#preview').muted = false; $('#preview').controls = true; $('#timer').textContent = 'Recovered take';
        $('#download').href = blobUrl; $('#download').download = `${recordingId}.webm`; $('#download').hidden = false;
        status('Recovered from this browser. Review or download it, then Retry save.'); controls();
      };
      $('#recovery-list').append(button);
    }
    $('#recovery').hidden = !$('#recovery-list').children.length; controls();
  } catch (error) {
    if (error.name === 'DraftUpgradeBlocked') status(error.message);
    // Recording still works if browser storage is unavailable.
  }
}
$('#reset-take').onclick = () => {
  if (!draftBackedUp || saving || recording) return;
  unsaved = false; draftId = null; clearTake(); showSaved(); controls(); refreshDrafts();
  status('Controls reset. The unsaved take remains under Recover unsaved takes.');
};
$('#loop').onchange = () => { $('#preview').loop = $('#loop').checked; };
$('#preview').onloadedmetadata = () => {
  $('#trim-start').value = 0;
  $('#trim-end').value = Number.isFinite($('#preview').duration) ? $('#preview').duration.toFixed(2) : '';
};
for (const edge of ['start', 'end']) {
  $('#mark-' + edge).onclick = () => { $('#trim-' + edge).value = $('#preview').currentTime.toFixed(2); trimPreview = false; };
  $('#trim-' + edge).oninput = () => { trimPreview = false; };
}
function trimRange() {
  const start = Number($('#trim-start').value), end = Number($('#trim-end').value);
  if (!$('#trim-end').value || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > $('#preview').duration + 0.05 || end > 120) throw new Error('Choose a start and end within the clip (up to 120 seconds).');
  return { start, end };
}
$('#preview-trim').onclick = () => {
  try { const { start } = trimRange(); trimPreview = true; $('#preview').currentTime = start; $('#preview').play().catch(() => {}); }
  catch (error) { status(error.message); }
};
$('#preview').ontimeupdate = () => {
  if (trimPreview && $('#preview').currentTime >= Number($('#trim-end').value)) {
    if ($('#loop').checked) $('#preview').currentTime = Number($('#trim-start').value);
    else { $('#preview').pause(); trimPreview = false; }
  }
};
$('#save-trim').onclick = async () => {
  if (saving || recording || unsaved) return;
  try {
    const range = trimRange();
    saving = true; trimPreview = false; $('#preview').pause(); controls(); status('Saving trimmed clip…');
    const response = await fetch('/api/recordings/' + selectedId + '/trim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': token }, body: JSON.stringify({ ...range, original: recordings[selectedId].original }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    recordings[selectedId] = result.recording; showSaved(); status('Trim saved. Source files kept.');
  } catch (error) { status(error.message); }
  finally { saving = false; controls(); }
};
async function save() {
  let savedSuccessfully = false;
  saving = true; controls(); status('Saving recording… Keep this page open.');
  try {
    // Dev-server restarts rotate the token. Refresh it without losing the take.
    const session = await fetch('/api/recordings', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!session.ok) throw new Error('Local recording server is unavailable');
    token = (await session.json()).token;
    const response = await fetch(`/api/recordings/${recordingId}?originalOnly=1`, { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Recording-Token': token }, body: blob, signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    recordings[recordingId] = result.recording; unsaved = false;
    if (draftId) { await removeDraft(draftId).catch(() => {}); draftId = null; }
    refreshDrafts();
    savedSuccessfully = true;
    showSaved();
    status(result.recording.processingError || 'Saved.');
    if ($('#auto-analyze').checked) {
      try {
        const queued = await fetch(`/api/recordings/${recordingId}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': token }, body: JSON.stringify({ source: result.recording.original, useAutomatically: $('#auto-use-animation').checked, autoCreateArtwork: $('#auto-create-selected-art').checked }), signal: AbortSignal.timeout(15000) });
        const job = await queued.json();
        status(queued.ok ? 'Saved. Animation analysis queued in the background.' : `Saved. ${job.error}`);
      } catch { status('Saved. Could not queue analysis; use Analyze this take to retry.'); }
    }
    list();
  } catch (error) { unsaved = true; status(`Save failed: ${error.message}. Retry, or download this take before leaving.`); }
  finally { saving = false; controls(); if (savedSuccessfully && $('#auto-next').checked) $('#next').click(); }
}
async function start() {
  if (!stream || !current() || recording || starting || saving) return;
  starting = true; controls(); live();
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
  let chunks = [];
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
    recordingId = selectedId;
    draftWrites = []; draftBackedUp = false;
    try { draftId = await beginDraft(recordingId, recorder.mimeType || 'audio/webm', selectedCoach()); }
    catch { draftId = null; }
    const activeDraft = draftId;
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      const index = chunks.length; chunks.push(event.data);
      if (activeDraft) draftWrites.push(appendDraft(activeDraft, index, event.data).then(() => true, () => false));
    };
    recorder.onstop = async () => {
      clearInterval(elapsedTimer); clearTimeout(limitTimer); recording = false;
      $('#recording-indicator').hidden = true; document.title = 'Saving audio — Coach studio';
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      const take = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
      if (!take.size) { status('The recording was empty. Try again.'); controls(); return; }
      clearTake(); blob = take; unsaved = true; blobUrl = URL.createObjectURL(blob);
      $('#preview').classList.remove('live-preview', 'styled-preview');
      $('#preview').srcObject = null; $('#preview').src = blobUrl; $('#preview').muted = false; $('#preview').controls = true; $('#preview').autoplay = false;
      $('#timer').textContent = 'Saving take';
      $('#download').href = blobUrl; $('#download').download = `${recordingId}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`; $('#download').hidden = false;
      const backups = await Promise.all(draftWrites);
      draftBackedUp = !!activeDraft && backups.length === chunks.length && backups.every(Boolean);
      await save();
    };
    recorder.onerror = () => { status('Recording interrupted. Check your microphone.'); if (recorder.state !== 'inactive') recorder.stop(); };
    recorder.start(250); recording = true;
    $('#recording-elapsed').textContent = '0:00';
    const began = Date.now();
    $('#timer').textContent = '● Recording 0:00';
    elapsedTimer = setInterval(() => { const seconds = Math.floor((Date.now() - began) / 1000); const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; $('#timer').textContent = `● Recording ${elapsed}`; $('#recording-elapsed').textContent = elapsed; }, 250);
    limitTimer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 120000);
    status('Recording · 2-minute limit');
  } catch (error) { status(`Could not record: ${error.message}`); }
  finally { starting = false; controls(); }
}
async function enableMicrophone() {
  if (!supported || microphoneStarting || recording || starting || saving) return false;
  microphoneStarting = true; controls(); status('Waiting for microphone access…');
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: $('#microphone').value ? { deviceId: { exact: $('#microphone').value } } : true,
    });
    stream?.getTracks().forEach(track => track.stop()); stream = nextStream;
    for (const [selector, kind, track] of [['#microphone', 'audioinput', stream.getAudioTracks()[0]]]) {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === kind);
      $(selector).replaceChildren(...devices.map((device, index) => new Option(device.label || `${kind} ${index + 1}`, device.deviceId)));
      $(selector).value = track.getSettings().deviceId;
    }
    live(); $('#timer').textContent = 'Ready'; status('Ready.');
    return true;
  } catch (error) { status(`Microphone unavailable: ${error.message}. Allow access in your browser, then try again.`); return false; }
  finally { microphoneStarting = false; controls(); }
}
for (const group of new Set(recordingPhrases.map(item => item.group))) $('#group').add(new Option(group, group));
$('#upload-video').onclick = () => $('#upload-file').click();
async function importAudio(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !current() || saving || recording) return;
  if (file.size > 100 * 1024 * 1024) { status('This clip is over 100 MB. Record a shorter clip or use a shorter audio file.'); return; }
  const extension = file.name.split('.').at(-1).toLowerCase();
  const mime = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac'].includes(file.type) ? file.type : ({ webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' })[extension];
  if (!mime) { status('Choose WAV, MP3, M4A, Ogg, FLAC or WebM audio.'); return; }
  clearTake(); recordingId = selectedId; blob = file.slice(0, file.size, mime); unsaved = true; blobUrl = URL.createObjectURL(blob);
  $('#preview').classList.remove('live-preview', 'styled-preview');
  $('#preview').srcObject = null; $('#preview').src = blobUrl; $('#preview').muted = false; $('#preview').controls = true; $('#preview').autoplay = false;
  $('#timer').textContent = 'Uploaded audio';
  $('#download').href = blobUrl; $('#download').download = file.name; $('#download').hidden = false;
  draftBackedUp = false;
  try { draftId = await beginDraft(recordingId, mime, selectedCoach()); await appendDraft(draftId, 0, blob); draftBackedUp = true; } catch { draftId = null; }
  await save();
}
$('#upload-file').onchange = importAudio;
$('#enable').onclick = enableMicrophone;
$('#microphone').onchange = enableMicrophone;
$('#record').onclick = async () => {
  if (!supported || !current() || recording || starting || microphoneStarting || saving || unsaved || !token) return;
  if (!stream?.active && !await enableMicrophone()) return;
  await start();
};
$('#stop').onclick = () => { if (recorder?.state === 'recording') { status('Stopping microphone and saving audio…'); recorder.stop(); } };
$('#retry').onclick = save;
$('#next').onclick = () => {
  const group = recordingPhrases.filter(item => !$('#group').value || item.group === $('#group').value);
  const index = group.findIndex(item => item.id === selectedId);
  const ordered = [...group.slice(index + 1), ...group.slice(0, index + 1)];
  selectedId = null;
  select(ordered.find(item => !recordings[item.id])?.id);
};
$('#phrase').onchange = () => { select($('#phrase').value); if (narrowStudio.matches) $('#phrase-picker').open = false; };
$('#search').oninput = $('#saved-only').onchange = $('#group').onchange = $('#remaining').onchange = () => { selectedId = null; select(filtered()[0]?.id); };
window.addEventListener('beforeunload', event => { if (recording || saving || unsaved || analysisLocked) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => stream?.getTracks().forEach(track => track.stop()));
let refreshing = false;
async function refreshRecordings() {
  if (refreshing || document.hidden || recording || saving || starting || microphoneStarting || unsaved || analysisLocked || $('#editor').open) return;
  refreshing = true;
  try {
    const response = await fetch('/api/recordings', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    // A take or device change may have started while this request was pending.
    if (recording || saving || starting || microphoneStarting || unsaved || analysisLocked || $('#editor').open) return;
    const previous = JSON.stringify(recordings[selectedId]);
    ({ token, recordings } = result);
    if (recordings[selectedId] && previous !== JSON.stringify(recordings[selectedId])) {
      clearTake();
      showSaved();
      status('Recording updated.');
    }
    list(); controls();
  } catch { /* Keep the current preview if the server is briefly unavailable. */ }
  finally { refreshing = false; }
}
window.addEventListener('focus', refreshRecordings);
document.addEventListener('visibilitychange', refreshRecordings);
setInterval(refreshRecordings, 5000);
async function refreshAnalysisJobs() {
  if (jobsRefreshing || document.hidden) return;
  jobsRefreshing = true;
  try {
    const response = await fetch('/api/recordings/analysis-jobs', { cache: 'no-store' });
    if (!response.ok) throw new Error('Analysis status unavailable');
    const { jobs } = await response.json();
    const changed = JSON.stringify(jobs) !== JSON.stringify(analysisJobs);
    analysisJobs = jobs;
    const active = jobs.filter(job => ['running', 'queued'].includes(job.status));
    const failed = jobs.filter(job => ['failed', 'interrupted'].includes(job.status));
    const running = active.find(job => job.status === 'running');
    const lines = [active.length ? `Processing ${active.length} recording${active.length === 1 ? '' : 's'}${running ? ` · ${running.phraseId}: ${running.stage}` : ' · queued'}` : '', failed.length ? `${failed.length} recording${failed.length === 1 ? '' : 's'} need attention · select a flagged phrase to retry` : ''].filter(Boolean);
    $('#analysis-activity').hidden = !lines.length;
    $('#analysis-activity').textContent = lines.join('\n');
    $('#analysis-activity').classList.toggle('is-analyzing', !!active.length);
    if (changed) list();
  } catch {
    $('#analysis-activity').hidden = false;
    $('#analysis-activity').textContent = 'Cannot check analysis progress. Reconnecting to the local server…';
  } finally { jobsRefreshing = false; }
}
setInterval(refreshAnalysisJobs, 2500);
window.addEventListener('focus', refreshAnalysisJobs);
document.addEventListener('visibilitychange', refreshAnalysisJobs);
refreshAnalysisJobs();
try {
  const response = await fetch('/api/recordings', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  ({ token, recordings } = await response.json());
  select((recordingPhrases.find(phrase => !recordings[phrase.id]) || recordingPhrases[0])?.id);
  status(recordings[selectedId] ? 'Saved.' : supported ? 'Ready.' : 'Microphone recording requires a supported browser on HTTPS or localhost. You can still upload audio.');
} catch { select(recordingPhrases[0]?.id); status('Start the app with npm run dev, then open Recording studio from its menu. Local saving is unavailable on this server.'); }
controls();
refreshDrafts();

