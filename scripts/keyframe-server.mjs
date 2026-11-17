import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { localVideoPath } from './video-processing.mjs';
import { prepareKeyframes, renderKeyframes, validateSelection } from './keyframe-recording.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';

export function keyframeServer(root, { prepare = prepareKeyframes, render = renderKeyframes } = {}) {
  const jobs = new Map(); let queue = Promise.resolve();
  return async (req, res, url, send) => {
    const match = url.pathname.match(/^\/api\/recordings\/([a-z0-9-]+)\/keyframes(?:\/(prepare|render))?$/);
    if (!match) return false;
    const [, id, operation] = match;
    if (!recordingPhrases.some(phrase => phrase.id === id)) { send(404, { error: 'Unknown phrase.' }); return true; }
    const saved = (await readRecordings(root))[id];
    if (!saved?.original) { send(404, { error: 'Record this phrase first.' }); return true; }
    const reference = saved.keyframes;
    const manifest = reference?.url ? JSON.parse(await readFile(localVideoPath(root, reference.url), 'utf8')) : null;
    if (req.method === 'GET' && !operation) {
      const job = jobs.get(id);
      send(200, { manifest, job: job?.source === saved.original ? job : null }); return true;
    }
    if (req.method !== 'POST' || !operation) { send(405, { error: 'Method not supported.' }); return true; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 32000) { send(413, { error: 'Request too large.' }); return true; } }
    let data;
    try { data = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON.' }); return true; }
    if (data?.source !== saved.original) { send(409, { error: 'Take changed. Reload before generating.' }); return true; }
    const existing = jobs.get(id);
    if (existing && ['queued', 'running'].includes(existing.status)) { send(202, { job: existing }); return true; }
    if (operation === 'prepare' && ![.4, .65, 1].includes(data.gap ?? .65)) { send(400, { error: 'Invalid frame density.' }); return true; }
    if (operation === 'render') {
      if (!manifest || manifest.id !== data.manifestId || reference.revision !== data.revision || manifest.source !== saved.original) { send(409, { error: 'Frame selection changed. Reload before rendering.' }); return true; }
      try { data.selected = validateSelection(manifest, data.selected); }
      catch (error) { send(400, { error: error.message }); return true; }
    }
    const job = { id: randomUUID(), source: saved.original, status: 'queued', stage: 'Queued', operation };
    jobs.set(id, job);
    queue = queue.then(async () => {
      try {
        job.status = 'running';
        const progress = async stage => { job.stage = stage; };
        let result;
        if (operation === 'prepare') result = await prepare(root, id, saved, { gap: data.gap ?? .65, progress });
        else {
          const rendered = await render(root, manifest, data.selected, { progress });
          result = { ...manifest, selected: data.selected, renders: [...manifest.renders, rendered], activeRender: rendered.id, status: 'rendered' };
        }
        const revision = randomUUID(), resultUrl = `/coach/shared/keyframes/${result.id}/revision-${revision}.json`;
        result.revision = revision;
        await writeFile(localVideoPath(root, resultUrl), JSON.stringify(result, null, 2));
        let attached = false;
        await updateRecordings(root, recordings => {
          if (recordings[id]?.original !== saved.original || JSON.stringify(recordings[id]?.keyframes) !== JSON.stringify(reference)) return;
          recordings[id].keyframes = { id: result.id, url: resultUrl, revision }; attached = true;
        });
        job.status = attached ? 'complete' : 'superseded';
        job.stage = attached ? (operation === 'prepare' ? 'Frames ready to review' : 'Retro animation ready to preview') : 'Take changed. Results kept in the keyframes folder.';
      } catch (error) { job.status = 'failed'; job.stage = error.message; }
    }).catch(error => { job.status = 'failed'; job.stage = error.message; });
    send(202, { job }); return true;
  };
}
