import { coachFetch as fetch, selectedCoach } from './coach-session.js';
import { defaultStyleImage as styleImage } from './coach-artwork.js';

export function createCoachSettings(host, { getToken, isLocked, onBusyChanged, onReferenceChanged }) {
  host.innerHTML = `<h2>Coaches</h2><div class="devices"><label>Working on coach<select id="coach-select"></select></label><label>New coach name<input id="new-coach-name" maxlength="60" placeholder="Coach name"></label><button id="add-coach">Add coach</button></div>
  <details class="studio-section"><summary>Coach name &amp; cloned voice</summary><div class="devices"><label>Name<input id="coach-name" maxlength="60"></label><label>Cloned voice ID<input id="coach-voice" maxlength="200" placeholder="Set up the clone with your voice provider"></label><button id="save-coach">Save coach</button></div><p class="note">Use a saved Fish Speech voice, or upload a reference sample and its transcript below. No voice clone is required until you are ready to generate phrases.</p></details>
  <details class="studio-section" id="fish-settings"><summary>Fish Speech Drama 3 · connection &amp; voice setup</summary>
  <label>Fish Speech base URL<input id="fish-url" type="url" placeholder="http://192.168.1.84:8080"></label><div class="actions"><button id="save-fish-url">Save connection</button><button id="check-fish">Check readiness &amp; list voices</button></div><p id="fish-status" class="note" role="status"></p><p class="note">This app connects from this PC. Use the LAN address after enabling LAN binding on spark-25d9. Localhost works only when both services run on the same machine. Speech requests run one at a time and can take up to 10 minutes.</p>
  <label>Saved Fish Speech voices<select id="fish-voices"><option value="">Check readiness to load voices</option></select></label><button id="use-fish-voice">Use selected voice for this coach</button>
  <details><summary>Create a voice reference</summary><p class="note">Upload a clear voice sample with the exact words spoken. This sends the sample to your configured Fish Speech server and saves its voice ID for this coach.</p><label>New voice ID<input id="fish-reference-id" maxlength="100" placeholder="narrator"></label><label>Reference audio<input id="fish-reference-audio" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac"></label><label>Exact transcript<textarea id="fish-reference-text" rows="3" maxlength="10000"></textarea></label><button id="upload-fish-reference">Upload voice reference</button></details></details>
  <details class="studio-section" id="coach-images" open><summary>Coach reference images</summary><p class="note">Add photos now or later. Select up to six to create core portraits in the current avatar’s style, then approve the portraits to use for future emotion frames.</p>
  <div class="reference-overview"><figure><img id="coach-style-image" src="${styleImage}" alt="Coach art style guide"><figcaption id="coach-style-caption">Shared art style</figcaption></figure><figure><img id="active-core" alt="Approved core artwork" hidden><figcaption id="active-core-caption">Checking core artwork…</figcaption></figure></div>
  <label class="upload-label">Add reference images<input id="coach-photos" type="file" multiple accept="image/png,image/jpeg,image/webp"></label><div id="coach-photo-list" class="reference-grid"></div>
  <div class="actions"><label>Core candidates<select id="core-count"><option>1</option><option>2</option><option selected>3</option></select></label><button id="generate-core">Generate core portraits · paid</button></div><p id="core-jobs" class="note" role="status"></p>
  <div id="core-candidates" class="reference-grid"></div><button id="approve-core">Use selected core portraits</button><p class="note">Approving a set changes future artwork generation. Existing takes and artwork remain available.</p></details><p id="coach-settings-status" role="status"></p>`;
  const $ = selector => host.querySelector(selector);
  const coachSelect = $('#coach-select');
  const coachLabel = coachSelect.closest('label'); coachLabel.className = 'studio-coach-selector';
  document.querySelector('#active-coach-control').append(coachLabel);
  let busy = false, artworkKey = '', photoIds = new Set(), candidateIds = new Set();
  const displayCoach = profile => { document.querySelector('#studio-heading').textContent = `${profile.name}’s studio`; const option = [...coachSelect.options].find(item => item.value === profile.id); if (option) option.textContent = profile.name; };
  const message = value => { $('#coach-settings-status').textContent = value; };
  async function request(route, body) {
    const response = await fetch('/api/recordings/' + route, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': getToken() }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  function lock(value) { busy = value; coachSelect.disabled = value; onBusyChanged?.(); host.querySelectorAll('button,input,select').forEach(node => { node.disabled = value; }); }
  async function act(action) {
    if (busy || isLocked()) { message('Finish or save the current take/animation before changing coaches or artwork.'); return; }
    lock(true); try { await action(); } catch (error) { message(error.message); } finally { lock(false); }
  }
  function cards(target, items, selected, caption) {
    target.replaceChildren(...items.map(item => {
      const label = document.createElement('label'), image = new Image(), check = document.createElement('input');
      image.src = item.image; image.alt = caption; check.type = 'checkbox'; check.checked = selected.has(item.id);
      check.onchange = () => { check.checked ? selected.add(item.id) : selected.delete(item.id); };
      label.append(image, check, document.createTextNode(caption)); return label;
    }));
  }
  async function refreshArtwork() {
    if (busy || document.hidden) return;
    const data = await request('artwork'), fingerprint = JSON.stringify(data);
    if (fingerprint === artworkKey) return;
    const initial = !artworkKey; artworkKey = fingerprint;
    if (initial) { data.uploads.slice(-6).forEach(item => photoIds.add(item.id)); data.candidates.filter(item => data.reference.images?.includes(item.image)).forEach(item => candidateIds.add(item.id)); }
    cards($('#coach-photo-list'), data.uploads, photoIds, 'Identity reference');
    cards($('#core-candidates'), data.candidates, candidateIds, 'Core portrait');
    $('#coach-style-image').src = data.reference.styleImage || styleImage;
    $('#coach-style-caption').textContent = data.reference.styleImage ? 'Coach pixel-art reference' : 'Shared art style';
    $('#active-core').src = data.reference.image || styleImage; $('#active-core').hidden = !!data.reference.pending;
    $('#active-core-caption').textContent = data.reference.name;
    $('#core-jobs').textContent = data.jobs.slice(-3).map(job => `${job.status}: ${job.completed}/${job.count} portraits${job.message ? ' · ' + job.message : ''}`).join('\n');
  }
  async function checkFish() {
    const status = await request('voice?refresh=1');
    $('#fish-url').value = status.baseUrl || 'http://192.168.1.84:8080';
    $('#fish-status').textContent = status.message;
    if (!status.ready) return;
    const payload = await request('voice/references');
    const entries = Array.isArray(payload) ? payload : payload?.references || payload?.reference_ids || [];
    const ids = entries.map(item => typeof item === 'string' ? item : item.id || item.reference_id).filter(Boolean);
    $('#fish-voices').replaceChildren(new Option(ids.length ? 'Choose a saved voice' : 'No saved voices yet', ''), ...ids.map(id => new Option(id, id)));
  }
  $('#check-fish').onclick = () => act(checkFish);
  $('#save-fish-url').onclick = () => act(async () => { const status = await request('voice/config', { baseUrl: $('#fish-url').value }); $('#fish-status').textContent = status.message; message('Fish Speech connection saved.'); });
  $('#use-fish-voice').onclick = () => act(async () => {
    const voiceId = $('#fish-voices').value; if (!voiceId) throw new Error('Select a saved voice first.');
    await request('profile', { name: $('#coach-name').value, voiceId }); $('#coach-voice').value = voiceId; message('Fish Speech voice selected for this coach.');
  });
  $('#upload-fish-reference').onclick = () => act(async () => {
    const file = $('#fish-reference-audio').files[0]; if (!file || file.size > 30 * 1024 * 1024) throw new Error('Choose a voice sample under 30 MB.');
    const form = new FormData(); form.set('id', $('#fish-reference-id').value); form.set('text', $('#fish-reference-text').value); form.set('audio', file);
    $('#fish-status').textContent = 'Uploading voice reference… Keep this page open.';
    const response = await fetch('/api/recordings/voice/references/add', { method: 'POST', headers: { 'X-Recording-Token': getToken() }, body: form, signal: AbortSignal.timeout(610000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    $('#coach-voice').value = result.voiceId; message('Voice reference saved and selected for this coach.'); await checkFish();
  });
  request('voice').then(status => { $('#fish-url').value = status.baseUrl || 'http://192.168.1.84:8080'; $('#fish-status').textContent = status.message; }).catch(error => { $('#fish-status').textContent = error.message; });
  coachSelect.onchange = () => {
    if (isLocked() || busy) { coachSelect.value = selectedCoach(); message('Save your current work before switching coaches.'); return; }
    location.href = `/studio.html?coach=${encodeURIComponent(coachSelect.value)}`;
  };
  $('#add-coach').onclick = () => act(async () => {
    const result = await request('coaches', { name: $('#new-coach-name').value });
    location.href = `/studio.html?coach=${encodeURIComponent(result.profile.id)}`;
  });
  $('#save-coach').onclick = () => act(async () => { const result = await request('profile', { name: $('#coach-name').value, voiceId: $('#coach-voice').value }); displayCoach(result.profile); message('Coach and voice ID saved.'); });
  $('#coach-photos').onchange = () => {
    const files = [...$('#coach-photos').files]; $('#coach-photos').value = '';
    act(async () => {
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Choose PNG, JPEG or WebP files under 12 MB each.');
        const response = await fetch('/api/recordings/artwork/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Recording-Token': getToken() }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error); if (photoIds.size < 6) photoIds.add(result.upload.id);
      }
      message('Images added. Select references and generate core portraits.');
    }).then(refreshArtwork);
  };
  $('#generate-core').onclick = () => act(async () => { await request('artwork/generate', { uploadIds: [...photoIds], count: Number($('#core-count').value) }); message('Core portraits queued. You can continue working while they generate.'); }).then(refreshArtwork);
  $('#approve-core').onclick = () => act(async () => { await request('artwork/approve', { ids: [...candidateIds] }); await onReferenceChanged(); message('Core portraits approved. Future emotion frames will use this set.'); }).then(refreshArtwork);
  request('coaches').then(({ coaches, profile }) => {
    coachSelect.replaceChildren(...coaches.map(item => new Option(item.name, item.id))); coachSelect.value = profile.id; displayCoach(profile);
    $('#coach-name').value = profile.name; $('#coach-voice').value = profile.voiceId || '';
  }).catch(error => message(error.message));
  refreshArtwork().catch(error => message(error.message));
  setInterval(() => refreshArtwork().catch(() => {}), 3000);
  return { locked: () => busy };
}
