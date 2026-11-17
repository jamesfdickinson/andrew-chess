import { coachFetch as fetch } from './coach-session.js';
import { recordingPhrases } from './recording-phrases.js';

export function createVoiceStudio(host, { getContext, changed, onBusyChanged }) {
  host.innerHTML = `<details class="studio-section" open><summary>Phrase audio &amp; cloned voice</summary><label>Text to speak<textarea id="voice-text" rows="2" maxlength="3000"></textarea></label><button id="generate-voice" disabled>Generate voice</button><p id="voice-status" class="note" role="status">Checking voice connection…</p>
  <label>Saved takes<select id="audio-takes"></select></label><div class="actions"><button id="preview-take">Listen to selected take</button><button id="use-take">Use selected take</button></div><audio id="take-audio" controls hidden></audio>
  <details><summary>Generate a batch of phrases</summary><p class="note">Select up to 30 phrases. Each uses its standard phrase text and this coach’s saved voice ID. Existing takes are retained.</p><select id="voice-batch" multiple size="7" aria-label="Phrases to generate"></select><button id="generate-batch" disabled>Generate selected phrases</button></details><p id="voice-jobs" class="note" role="status"></p></details>`;
  const $ = selector => host.querySelector(selector);
  $('#voice-batch').replaceChildren(...recordingPhrases.map(phrase => new Option(`${phrase.id} · ${phrase.text}`, phrase.id)));
  let ready = false, voiceId = '', busy = false, selected = '', source = '', polling = false, lastJobs = '';
  async function request(route, body) {
    const response = await fetch('/api/recordings' + (route ? '/' + route : ''), body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Token': getContext().token }, body: JSON.stringify(route === 'voice/generate' ? { ...body, useAutomatically: document.querySelector('#auto-use-animation').checked, autoCreateArtwork: document.querySelector('#auto-create-selected-art').checked } : body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  function update() {
    const ctx = getContext(), locked = ctx.locked || busy || !ctx.token;
    $('#generate-voice').disabled = locked || !ready || !voiceId || !ctx.phrase;
    $('#generate-batch').disabled = locked || !ready || !voiceId;
    $('#use-take').disabled = locked || !$('#audio-takes').value || $('#audio-takes').value === ctx.saved?.original;
    $('#preview-take').disabled = locked || !$('#audio-takes').value;
    $('#voice-text').disabled = locked; $('#audio-takes').disabled = locked; $('#voice-batch').disabled = locked;
  }
  function select() {
    const ctx = getContext();
    if (selected !== ctx.phrase?.id) { selected = ctx.phrase?.id; $('#voice-text').value = ctx.saved?.generatedText || ctx.phrase?.text || ''; $('#take-audio').pause(); }
    const key = JSON.stringify([ctx.saved?.original, ctx.saved?.takes?.map(take => take.original)]);
    if (source !== key) {
      source = key;
      const takes = ctx.saved ? [ctx.saved, ...(ctx.saved.takes || []).toReversed()] : [];
      $('#audio-takes').replaceChildren(...takes.map((take, index) => new Option(`${index === 0 ? 'Current' : 'Previous'} · ${take.savedAt ? new Date(take.savedAt).toLocaleString() : 'Legacy take'}${take.voiceId ? ' · generated' : ''}`, take.original)));
    }
    update();
  }
  async function act(action) {
    if (getContext().locked || busy) return;
    busy = true; update(); onBusyChanged?.();
    try { await action(); } catch (error) { $('#voice-status').textContent = error.message; }
    finally { busy = false; select(); onBusyChanged?.(); }
  }
  $('#generate-voice').onclick = () => act(async () => {
    const phrase = getContext().phrase;
    const result = await request('voice/generate', { items: [{ id: phrase.id, text: $('#voice-text').value }] });
    $('#voice-status').textContent = result.queued.length ? 'Voice queued. Previous audio stays available while this take generates.' : 'This phrase is already queued.';
  });
  $('#generate-batch').onclick = () => act(async () => {
    const ids = [...$('#voice-batch').selectedOptions].map(option => option.value);
    const items = recordingPhrases.filter(phrase => ids.includes(phrase.id)).map(phrase => ({ id: phrase.id, text: phrase.text }));
    const result = await request('voice/generate', { items }); $('#voice-status').textContent = `${result.queued.length} phrases queued.`;
  });
  $('#audio-takes').onchange = update;
  $('#preview-take').onclick = () => { $('#take-audio').hidden = false; $('#take-audio').src = $('#audio-takes').value; $('#take-audio').play().catch(error => { $('#voice-status').textContent = error.message; }); };
  $('#use-take').onclick = () => act(async () => {
    const ctx = getContext(); await request('takes/select', { phraseId: ctx.phrase.id, currentSource: ctx.saved.original, source: $('#audio-takes').value });
    await changed(); $('#voice-status').textContent = 'Selected take is now used in the game.';
  });
  async function poll() {
    if (polling || busy || document.hidden) return;
    polling = true;
    try {
      const data = await request('voice'); ready = data.ready; voiceId = data.profile.voiceId;
      if (!ready) $('#voice-status').textContent = data.message + ' Microphone recording and audio uploads remain available.';
      else if (!voiceId) $('#voice-status').textContent = 'Fish Speech is ready. Select or create this coach’s voice in Fish Speech Drama 3 below.';
      else if (!data.jobs.some(job => ['queued', 'running'].includes(job.status))) $('#voice-status').textContent = `Fish Speech ready · voice: ${voiceId}`;
      const key = JSON.stringify(data.jobs);
      if (key !== lastJobs) {
        lastJobs = key; $('#voice-jobs').replaceChildren();
        for (const job of data.jobs.slice(-8).toReversed()) {
          const row = document.createElement('p'); row.textContent = `${job.phraseId}: ${job.status}${job.message ? ' · ' + job.message : ''}`;
          if (['failed', 'interrupted'].includes(job.status)) {
            const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = () => act(() => request('voice/generate', { items: [{ id: job.phraseId, text: job.text }] })); row.append(retry);
          }
          $('#voice-jobs').append(row);
        }
        await changed();
      }
      select();
    } catch (error) { $('#voice-status').textContent = error.message; }
    finally { polling = false; }
  }
  setInterval(poll, 3000); poll();
  return { select, update, locked: () => busy };
}
