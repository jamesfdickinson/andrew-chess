import { readFile } from 'node:fs/promises';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';

export async function normalizeAudio(root, source) {
  const audio = `${source}.wav`;
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', localVideoPath(root, source), '-t', '121', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', localVideoPath(root, audio)]);
  const bytes = (await readFile(localVideoPath(root, audio))).length;
  if (bytes <= 100 || bytes > 120 * 24000 * 2 + 100) throw new Error('Audio must contain sound and be no longer than two minutes.');
  return { original: audio, uploadedOriginal: source, mediaType: 'audio', bytes };
}
