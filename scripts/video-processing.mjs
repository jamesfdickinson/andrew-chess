import { mediaFile } from './media-paths.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import ffmpeg from 'ffmpeg-static';

export async function readStyle(root) {
  const style = JSON.parse(await readFile(path.join(root, 'coach-video-style.json'), 'utf8'));
  for (const [key, min, max] of [['size', 32, 640], ['pixelSize', 8, 640], ['fps', 1, 60], ['crf', 0, 40]]) {
    if (!Number.isInteger(style[key]) || style[key] < min || style[key] > max) throw new Error(`Invalid video style: ${key}`);
  }
  if (style.size % 2 || style.pixelSize > style.size) throw new Error('Use an even output size and a smaller pixel grid.');
  for (const key of ['saturation', 'contrast']) if (!Number.isFinite(style[key]) || style[key] < 0 || style[key] > 3) throw new Error(`Invalid video style: ${key}`);
  return style;
}
export function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || ffmpeg || 'ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Video processing timed out. Original kept.')); }, 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stderr) : reject(new Error(stderr || 'Video processing failed.')); });
  });
}
export function localVideoPath(root, url) {
  if (typeof url !== 'string' || !/^\/coach\/[a-zA-Z0-9_./-]+$/.test(url)) throw new Error('Invalid recording path.');
  const directory = path.resolve(root, 'public', 'coach');
  const file = path.resolve(root, 'public', '.' + url);
  if (!file.startsWith(directory + path.sep)) throw new Error('Recording path is outside the coach folder.');
  return mediaFile(root, url);
}
async function processVariant(root, original, style) {
  const input = localVideoPath(root, original);
  const styleId = createHash('sha256').update(JSON.stringify(style)).digest('hex').slice(0, 8);
  const stem = path.basename(input, path.extname(input));
  const video = `/coach/shared/styled/${stem}-${style.size}x${style.size}-${styleId}-${randomUUID().slice(0, 8)}.mp4`;
  const output = localVideoPath(root, video);
  await mkdir(path.dirname(output), { recursive: true });
  // Center-crop without stretching, reduce the detail, then enlarge with hard pixel edges.
  const filters = `crop='min(iw,ih)':'min(iw,ih)',fps=${style.fps},scale=${style.pixelSize}:${style.pixelSize}:flags=area,eq=saturation=${style.saturation}:contrast=${style.contrast},scale=${style.size}:${style.size}:flags=neighbor,setsar=1`;
  try {
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(style.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', output]);
    return { video, style, styleId, styledBytes: (await stat(output)).size, processedAt: new Date().toISOString() };
  } catch (error) { await unlink(output).catch(() => {}); throw error; }
}

export async function processPixel32(root, original) {
  return processVariant(root, original, { size: 32, pixelSize: 32, fps: 12, saturation: 1, contrast: 1.03, crf: 18 });
}

// All outputs come directly from the untouched original.
export async function processVideo(root, original, style) {
  style ??= await readStyle(root);
  const main = await processVariant(root, original, style);
  let pixel50, natural100;
  try {
    pixel50 = await processVariant(root, original, { ...style, size: 50, pixelSize: 50 });
    natural100 = await processVariant(root, original, { ...style, size: 100, pixelSize: 100, saturation: 1, contrast: 1.03, crf: 18 });
    const pixel32 = await processPixel32(root, original);
    return { ...main, variants: { pixel50, natural100, pixel32 } };
  } catch (error) {
    await unlink(localVideoPath(root, main.video)).catch(() => {});
    if (pixel50) await unlink(localVideoPath(root, pixel50.video)).catch(() => {});
    if (natural100) await unlink(localVideoPath(root, natural100.video)).catch(() => {});
    throw error;
  }
}
