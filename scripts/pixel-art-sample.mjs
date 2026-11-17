import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const id = process.argv[2] || 'out-of-pawns-01';
const recording = (await readRecordings(root))[id];
if (!recording?.original) throw new Error(`No original recording for ${id}`);
const input = localVideoPath(root, recording.original);
const stem = `${path.basename(input, path.extname(input))}-pixel-art80-${randomUUID().slice(0, 8)}`;
const video = `/coach/shared/styled/${stem}.mp4`;
const output = localVideoPath(root, video);
const palette = path.join(tmpdir(), `${stem}-palette.png`);
await mkdir(path.dirname(palette), { recursive: true });
await mkdir(path.dirname(output), { recursive: true });
const base = "crop='min(iw,ih)':'min(iw,ih)',fps=12,scale=80:80:flags=area,eq=contrast=1.12:saturation=1.08,format=rgb24";
try {
  // Build one palette across the entire take, preventing per-frame color shifts.
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input,
    '-vf', `${base},palettegen=max_colors=32:reserve_transparent=0:stats_mode=full`, '-frames:v', '1', '-update', '1', palette]);
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input, '-i', palette,
    '-filter_complex', `[0:v]${base}[pixels];[pixels][1:v]paletteuse=dither=none,scale=320:320:flags=neighbor,setsar=1[v]`,
    '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output]);
  const bytes = (await stat(output)).size;
  let attached = false;
  await updateRecordings(root, current => {
    if (current[id]?.original !== recording.original) return;
    current[id].variants ??= {};
    current[id].variants.pixelArt80 = { video, style: { size: 320, pixelSize: 80, colors: 32, fps: 12 },
      styledBytes: bytes, processedAt: new Date().toISOString() };
    attached = true;
  });
  console.log(JSON.stringify({ id, video, bytes: (await stat(output)).size, attached }));
} finally { await unlink(palette).catch(() => {}); }
