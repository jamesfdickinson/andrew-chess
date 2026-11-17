import { coachFetch as fetch } from './coach-session.js';
import { performanceCatalog } from './performance-catalog.js';
import { defaultStyleImage as defaultReference } from './coach-artwork.js';

export function createFrameSetStudio(host, { getToken, onLibraryChanged }) {
  host.innerHTML = `<summary>Create an emotion or gesture set</summary><div class="core-reference"><p>Core coach reference</p><img id="core-reference-preview" alt="Current coach reference for new artwork"><p class="note">Manage photos and approved core portraits in Coach reference images below.</p></div><p class="note">Choose a reusable performance. Nano Banana 2.1 uses this reference; no video is needed. One paid image request per new set. Existing generated sets for the same reference are reused.</p><label>Emotion + gesture<select id="manual-performance"></select></label><button id="create-manual-set" disabled>Create frame set · paid</button><p id="manual-art-status" class="note" role="status">Open this section to check the image service.</p><div id="manual-art-drafts"></div>`;
  const $ = selector => host.querySelector(selector);
  for (const entry of performanceCatalog) $('#manual-performance').add(new Option(`${entry.label} · ${entry.speaking ? 'talking + quiet' : 'silent'}`, entry.id));
  let assets = [], ready = false, busy = false, polling = false, fingerprint = '';
  async function request(route = '', body) {
    const response = await fetch(`/api/recordings/frame-sets${route}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': getToken() }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) } : { cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Artwork request failed.'); return result;
  }
  function controls() {
    const existing = assets.find(item => item.currentReference !== false && (item.performanceId || item.key) === $('#manual-performance').value);
    $('#create-manual-set').disabled = !ready || busy || !!existing;
    $('#manual-performance').disabled = busy;

    $('#manual-art-status').textContent = existing ? `${existing.name} · ${existing.status}${existing.error ? ' · ' + existing.error : ''}` : ready ? 'Ready to create one reusable set. Preview it below before adding it to the library.' : 'OpenRouter image generation is not configured.';
  }
  function render() {
    $('#manual-art-drafts').replaceChildren(...assets.filter(asset => asset.status === 'draft' && asset.currentReference !== false).map(asset => {
      const card = document.createElement('div'), title = document.createElement('p'); title.textContent = asset.name;
      const imageUrl = asset.revision ? `${asset.image}?v=${encodeURIComponent(asset.revision)}` : asset.image;
      const image = new Image(); image.src = imageUrl; image.alt = `${asset.name} frame sheet`; image.className = 'generated-sheet';
      const preview = document.createElement('div'); preview.className = 'generated-mouth-preview'; preview.style.backgroundImage = `url("${imageUrl}")`;
      const label = document.createElement('label'); label.className = 'check';
      const check = document.createElement('input'); check.type = 'checkbox'; label.append(check, document.createTextNode('Requested emotion, style and frame alignment checked'));
      const approve = document.createElement('button'); approve.textContent = 'Add to animation library'; approve.disabled = true;
      check.onchange = () => { approve.disabled = !check.checked; };
      approve.onclick = async () => {
        approve.disabled = true;
        try { const result = await request('/approve', { performanceId: asset.performanceId || asset.key }); assets = result.assets; await onLibraryChanged(); render(); controls(); }
        catch (error) { $('#manual-art-status').textContent = error.message; approve.disabled = !check.checked; }
      };
      card.append(title, image, preview, label, approve); return card;
    }));
  }
  async function poll() {
    if (!host.open || polling || busy || document.hidden) return;
    polling = true;
    try {
      const result = await request(); assets = result.assets; ready = result.ready;
      $('#core-reference-preview').src = result.reference?.image || defaultReference;

      const next = JSON.stringify(assets.map(asset => [asset.key, asset.status, asset.currentReference]));
      if (next !== fingerprint) { fingerprint = next; render(); }
      controls();
    } catch (error) { $('#manual-art-status').textContent = error.message; }
    finally { polling = false; }
  }
  $('#create-manual-set').onclick = async () => {
    if ($('#create-manual-set').disabled) return;
    busy = true; controls();
    try { const result = await request('', { performanceId: $('#manual-performance').value }); assets = result.assets; render(); }
    catch (error) { busy = false; controls(); $('#manual-art-status').textContent = error.message; return; }
    finally { busy = false; }
    controls();
  };
  $('#manual-performance').onchange = controls;
  $('#core-reference-preview').src = defaultReference;
  host.ontoggle = poll;
  setInterval(poll, 2500);
}
