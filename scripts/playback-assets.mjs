import { readFile, mkdir, access, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runFFmpeg } from './video-processing.mjs';
import { coachPath } from '../src/coach-paths.js';

export { mediaFile as publicFile } from './media-paths.mjs';
import { mediaFile as publicFile } from './media-paths.mjs';

// Content-addressed cache: identical source files share one conversion.
export async function audioFile(root, source) {
  const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 24);
  const directory = path.join(root, 'media-originals', 'audio');
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, `${hash}.m4a`);
  try { await access(output); return output; } catch {}
  const temporary = path.join(directory, `${hash}-${randomUUID()}.m4a`);
  try {
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', source,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', temporary]);
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  return output;
}

export function playbackRecording(saved, audio) {
  const original = saved.original || saved.video;
  return {
    original: audio, mediaType: 'audio',
    ...(saved.animation?.source === original ? { animation: { ...saved.animation, source: audio } } : {}),
    ...(saved.mouthSync?.source === original ? { mouthSync: { ...saved.mouthSync, source: audio } } : {}),
  };
}

export async function optionalJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(file));
    else result.push(file);
  }
  return result;
}

// Vite normally copies all of public, including studio intermediates and old takes.
// Emit only the manifests and media read by game playback instead.
export function playbackAssets(root) {
  return {
    name: 'playback-assets', apply: 'build',
    async generateBundle() {
      const emitted = new Set();
      const emit = (url, source) => {
        publicFile(root, url); // Validate output paths as well as input paths.
        if (emitted.has(url)) return;
        emitted.add(url);
        this.emitFile({ type: 'asset', fileName: url.slice(1), source });
      };
      const json = (url, data) => emit(url, JSON.stringify(data));
      const copy = async url => emit(url.split('?')[0], await readFile(publicFile(root, url)));
      await copy('/fonts/andrew-pixel.ttf');
      const profiles = await optionalJson(publicFile(root, '/coach/coaches.json'), [{ id: 'jimmy', name: 'Jimmy' }]);
      json('/coach/coaches.json', profiles.map(({ id, name }) => ({ id, name })));
      for (const profile of profiles) {
        if (!/^[a-zA-Z0-9-]+$/.test(profile.id)) throw new Error('Invalid coach ID');
        const base = coachPath(profile.id);
        const artwork = await optionalJson(publicFile(root, `${base}/artwork.json`), null);
        if (artwork) {
          for (const filename of Object.values(artwork.sheets || {})) await copy(`${artwork.base}/${filename}`);
          if (artwork.styleImage) await copy(artwork.styleImage);
          json(`${base}/artwork.json`, artwork);
        }
        const pending = await optionalJson(publicFile(root, `${base}/.recordings.pending.json`), null);
        const recordings = pending || await optionalJson(publicFile(root, `${base}/recordings.json`), {});
        const playback = {};
        for (const [id, saved] of Object.entries(recordings)) {
          const source = saved.original || saved.video;
          if (!source) continue;
          const file = await audioFile(root, publicFile(root, source));
          const url = `${base}/audio/${path.basename(file)}`;
          emit(url, await readFile(file));
          playback[id] = playbackRecording(saved, url);
        }
        json(`${base}/recordings.json`, playback);
        const sets = await optionalJson(publicFile(root, `${base}/frame-sets.json`), []);
        const approved = sets.filter(set => set.status === 'approved').map(({ key, setId, image, name, speaking, revision, status, referenceId, performanceId }) =>
          ({ key, setId, image, name, speaking, revision, status, referenceId, performanceId }));
        for (const set of approved) await copy(set.image);
        json(`${base}/frame-sets.json`, approved);
        const reference = await optionalJson(publicFile(root, `${base}/references/active.json`), { id: 'original', image: null });
        if (reference.image) await copy(reference.image);
        json(`${base}/references/active.json`, { id: reference.id, image: reference.image, name: reference.name });
      }
    },
  };
}
