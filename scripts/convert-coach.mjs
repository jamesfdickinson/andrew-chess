import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';

// Store genuinely small frames, then let image-rendering: pixelated enlarge them.
// Requires FFmpeg on PATH. Original recordings are never modified.
const [input, output, widthArg = '160', fpsArg = '12'] = process.argv.slice(2);
const width = Number(widthArg);
const fps = Number(fpsArg);
if (!input || !output || !Number.isInteger(width) || width < 32 || width > 640 || width % 2 || !Number.isInteger(fps) || fps < 1 || fps > 60) {
  console.error('Usage: npm run coach:convert -- input.mp4 public/coach/point.webm [even width: 160] [fps: 12]');
  process.exit(1);
}
if (!existsSync(input) || resolve(input) === resolve(output) || extname(output).toLowerCase() !== '.webm' || existsSync(output)) {
  console.error('Use an existing input and a new .webm output path. Existing files are never overwritten.');
  process.exit(1);
}
mkdirSync(dirname(resolve(output)), { recursive: true });
const result = spawnSync('ffmpeg', [
  '-hide_banner', '-n', '-i', resolve(input), '-map', '0:v:0',
  '-vf', `fps=${fps},scale=${width}:-2:flags=neighbor,setsar=1`,
  '-an', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-pix_fmt', 'yuv420p',
  resolve(output),
], { stdio: 'inherit' });
if (result.error) {
  console.error('FFmpeg could not start. Install FFmpeg and add its bin folder to PATH.');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
const before = statSync(input).size;
const after = statSync(output).size;
console.log(`Saved ${output}: ${(after / 1024).toFixed(1)} KB (${(after / before * 100).toFixed(1)}% of original).`);
