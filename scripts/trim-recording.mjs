import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';

export async function trimRecording(root, recording, start, end) {
  const outputs = [];
  const sources = new Map();
  async function trim(source) {
    if (!source) return source;
    if (sources.has(source)) return sources.get(source);
    const audioOnly = recording.mediaType === 'audio';
    const video = `/coach/shared/edits/${randomUUID()}.${audioOnly ? 'm4a' : 'mp4'}`;
    const output = localVideoPath(root, video);
    await mkdir(path.dirname(output), { recursive: true });
    outputs.push(output);
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', localVideoPath(root, source), '-ss', String(start), '-t', String(end - start), ...(audioOnly ? ['-vn', '-map', '0:a:0'] : ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p']), '-c:a', 'aac', '-movflags', '+faststart', output]);
    sources.set(source, video);
    return video;
  }
  try {
    const original = await trim(recording.original);
    const video = await trim(recording.video);
    const variants = {};
    for (const [key, variant] of Object.entries(recording.variants || {})) {
      const output = await trim(variant.video);
      variants[key] = { ...variant, video: output, ...(output ? { styledBytes: (await stat(localVideoPath(root, output))).size } : {}) };
    }
    const { analysis, animation, keyframes, mouthSync, generatedText, ...metadata } = recording;
    return { ...metadata, original, video, variants, bytes: (await stat(localVideoPath(root, original))).size,
      ...(video ? { styledBytes: (await stat(localVideoPath(root, video))).size } : {}),
      trimSource: { ...recording, takes: undefined }, takes: [...(recording.takes || []), { ...recording, takes: undefined }], trim: { start, end }, savedAt: new Date().toISOString() };
  } catch (error) {
    await Promise.all(outputs.map(file => unlink(file).catch(() => {})));
    throw error;
  }
}
