// Native Fish Speech API adapter for fishaudio/drama-3. No OpenAI API shim.
export class FishSpeechClient {
  constructor(baseUrl, { fetcher = fetch, generationTimeout = 600000 } = {}) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use a plain HTTP(S) Fish Speech base URL.');
    this.baseUrl = url.href.replace(/\/$/, ''); this.fetcher = fetcher; this.generationTimeout = generationTimeout;
  }
  async request(route, { method = 'GET', body, timeout = 10000, binary = false } = {}) {
    let response;
    try {
      response = await this.fetcher(this.baseUrl + route, { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { Accept: binary ? 'audio/*' : 'application/json', ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        ...(body === undefined ? {} : body instanceof FormData ? { body } : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'Fish Speech timed out. Check the server before retrying.' : 'Cannot reach Fish Speech. Check the base URL, LAN binding, and whether installation/model startup has finished.');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Fish Speech HTTP ${response.status}: ${detail || response.statusText}`);
    }
    if (!binary) {
      const text = await response.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch { return { message: text }; }
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 64 * 1024 * 1024) throw new Error('Fish Speech audio exceeds 64 MB.'); chunks.push(chunk); }
    if (!size) throw new Error('Fish Speech returned empty audio.');
    return Buffer.concat(chunks);
  }
  health() { return this.request('/v1/health', { timeout: 5000 }); }
  defaults() { return this.request('/v1/tts/defaults'); }
  listReferences() { return this.request('/v1/references/list'); }
  addReference({ id, audio, filename = 'reference.wav', text }) {
    const form = new FormData(); form.set('id', id); form.set('audio', audio, filename); form.set('text', text);
    return this.request('/v1/references/add', { method: 'POST', body: form, timeout: 600000 });
  }
  deleteReference(referenceId) { return this.request('/v1/references/delete', { method: 'DELETE', body: { reference_id: referenceId } }); }
  renameReference(oldId, newId) { return this.request('/v1/references/update', { method: 'POST', body: { old_reference_id: oldId, new_reference_id: newId } }); }
  generate({ text, referenceId, seed, format = 'wav' }) {
    if (!['wav', 'pcm', 'mp3', 'opus'].includes(format)) throw new Error('Unsupported Fish Speech audio format.');
    if (!text?.trim()) throw new Error('Enter text to speak.');
    return this.request('/v1/tts', { method: 'POST', binary: true, timeout: this.generationTimeout,
      body: { text, format, streaming: false, ...(referenceId ? { reference_id: referenceId } : {}), ...(seed === undefined ? {} : { seed }) } });
  }
}
