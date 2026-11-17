import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runFFmpeg, localVideoPath } from './video-processing.mjs';
import { ComfyClient, fluxWorkflow } from './comfy-keyframes.mjs';

const ff = args => runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
const json = file => readFile(file, 'utf8').then(JSON.parse);
export async function keyframeConfig(root) { return json(path.join(root, 'coach-keyframe-style.json')); }

// Visual-change heuristic, not an emotion classifier. Weight the central face area
// more than the background, retain large changes, and bound held-frame duration.
export function selectKeyframes(raw, { fps = 8, size = 64, gap = 0.65 } = {}) {
  const bytes = size * size, count = Math.floor(raw.length / bytes);
  if (!count) throw new Error('No video frames found.');
  const difference = (a, b) => {
    let sum = 0, weights = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const weight = x > size * .25 && x < size * .75 && y > size * .2 && y < size * .85 ? 4 : 1;
      sum += Math.abs(raw[a * bytes + y * size + x] - raw[b * bytes + y * size + x]) * weight; weights += weight;
    }
    return sum / weights;
  };
  const candidates = Array.from({ length: count }, (_, i) => ({ index: i, at: i / fps, change: i ? +difference(i, i - 1).toFixed(2) : 0 }));
  const selected = [0]; let previous = 0;
  const span = Math.max(2, Math.floor(gap * fps));
  while (previous + span < count) {
    const end = Math.min(count - 1, previous + span);
    let best = end, score = -1;
    for (let i = previous + Math.max(2, Math.floor(span / 2)); i <= end; i++) {
      const value = difference(i, previous) + candidates[i].change * .5;
      if (value > score) { score = value; best = i; }
    }
    selected.push(best); previous = best;
  }
  if (count > 1 && selected.at(-1) !== count - 1) selected.push(count - 1);
  return candidates.map(frame => ({ ...frame, selected: selected.includes(frame.index) }));
}

export async function prepareKeyframes(root, phraseId, saved, { id = randomUUID(), gap = .65, progress = async () => {} } = {}) {
  const base = `/coach/shared/keyframes/${id}`, directory = localVideoPath(root, base);
  await mkdir(directory, { recursive: true });
  const source = localVideoPath(root, saved.original);
  await progress('Scanning visual changes and retaining the original voice');
  await ff(['-i', source, '-t', '121', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', `${directory}/audio.pcm`]);
  const duration = (await readFile(`${directory}/audio.pcm`)).length / 32000;
  if (!duration || duration > 120) throw new Error('Use a recording with audio, up to 120 seconds.');
  await ff(['-i', source, '-t', String(duration), '-an', '-vf', "fps=8,crop='min(iw,ih)':'min(iw,ih)',scale=64:64", '-pix_fmt', 'gray', '-f', 'rawvideo', `${directory}/scan.gray`]);
  const candidates = selectKeyframes(await readFile(`${directory}/scan.gray`), { gap }).filter(frame => frame.at < duration);
  await ff(['-i', source, '-t', String(duration), '-an', '-vf', "fps=8,crop='min(iw,ih)':'min(iw,ih)',scale=256:256", '-start_number', '0', `${directory}/candidate-%04d.jpg`]);
  for (const frame of candidates) frame.image = `${base}/candidate-${String(frame.index).padStart(4, '0')}.jpg`;
  const manifest = { version: 1, id, phraseId, source: saved.original, duration, createdAt: new Date().toISOString(), status: 'prepared',
    method: '8 fps visual differences weighted toward the center; no emotion labels or facial tracking. Edit the selection before generation.',
    gap, candidates, selected: candidates.filter(frame => frame.selected).map(frame => frame.index), renders: [] };
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function validateSelection(manifest, indexes) {
  if (!Array.isArray(indexes) || indexes.length < 1 || indexes.length > 360 || indexes.some(i => !Number.isInteger(i) || !manifest.candidates.some(c => c.index === i))) throw new Error('Select between 1 and 360 valid frames.');
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  if (sorted[0] !== 0) throw new Error('Keep the first frame to cover the beginning of the recording.');
  return sorted;
}

export async function renderKeyframes(root, manifest, indexes, { progress = async () => {}, client, config } = {}) {
  const selected = validateSelection(manifest, indexes);
  config ??= await keyframeConfig(root);
  client ??= new ComfyClient(config);
  const renderId = randomUUID(), base = `/coach/shared/keyframes/${manifest.id}/${renderId}`, directory = localVideoPath(root, base);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/settings.json`, JSON.stringify({ ...config, selected, source: manifest.source }, null, 2));
  await progress('Checking Spark GPU availability');
  const unlock = await client.lock();
  const frames = [];
  try {
    await client.guard();
    // Crop the neutral cell from the established portrait sheet: fixed reference
    // across phrases, not the previous generated frame (which compounds drift).
    await ff(['-i', path.resolve(root, config.reference), '-vf', `crop=iw/3:ih/4:0:ih*3/4,scale=${config.size}:${config.size}:flags=neighbor`, '-frames:v', '1', `${directory}/reference.png`]);
    const reference = await client.upload(`${directory}/reference.png`, `andrew-${renderId}-reference.png`);
    for (const [position, index] of selected.entries()) {
      const candidate = manifest.candidates.find(frame => frame.index === index), stem = `frame-${String(position).padStart(4, '0')}`;
      await progress(`Stylizing frame ${position + 1} of ${selected.length} · ${candidate.at.toFixed(2)}s`);
      await ff(['-ss', String(candidate.at), '-i', localVideoPath(root, manifest.source), '-vf', `crop='min(iw,ih)*0.7':'min(iw,ih)*0.7':(iw-ow)/2:(ih-oh)*0.8,scale=${config.size}:${config.size}`, '-frames:v', '1', `${directory}/${stem}-source.png`]);
      const source = await client.upload(`${directory}/${stem}-source.png`, `andrew-${renderId}-${stem}.png`);
      const workflow = fluxWorkflow(config, reference, source, `andrew-studio/${renderId}/${stem}`);
      await client.generate(workflow, directory, stem);
      frames.push({ index, at: candidate.at, source: `${base}/${stem}-source.png`, generated: `${base}/${stem}.png`, image: `${base}/${stem}-retro.png` });
      await writeFile(`${directory}/progress.json`, JSON.stringify({ frames }, null, 2));
    }
  } finally { unlock(); }
  await progress('Applying a shared retro palette and synchronizing the original voice');
  // One palette from the character reference keeps colors consistent across phrases.
  await ff(['-i', `${directory}/reference.png`, '-vf', 'palettegen=max_colors=128:reserve_transparent=0', '-frames:v', '1', `${directory}/palette.png`]);
  for (const frame of frames) await ff(['-i', localVideoPath(root, frame.generated), '-i', `${directory}/palette.png`, '-filter_complex', `[0:v]scale=${config.pixelSize}:${config.pixelSize}:flags=area[p];[p][1:v]paletteuse=dither=none,scale=384:384:flags=neighbor`, '-frames:v', '1', localVideoPath(root, frame.image)]);
  const list = frames.map((frame, i) => `file '${path.basename(frame.image)}'\nduration ${((frames[i + 1]?.at ?? manifest.duration) - frame.at).toFixed(6)}`).join('\n') + `\nfile '${path.basename(frames.at(-1).image)}'\n`;
  await writeFile(`${directory}/frames.txt`, list);
  await ff(['-f', 'concat', '-safe', '0', '-i', `${directory}/frames.txt`, '-i', localVideoPath(root, manifest.source), '-map', '0:v:0', '-map', '1:a:0', '-t', String(manifest.duration), '-vf', 'fps=24', '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${directory}/animation.mp4`]);
  const render = { id: renderId, source: manifest.source, createdAt: new Date().toISOString(), duration: manifest.duration,
    video: `${base}/animation.mp4`, frames, settings: `${base}/settings.json`, status: 'draft', note: 'Held key poses with original audio. Review expression, character consistency and mouth timing; individual image edits are not temporally constrained.' };
  await writeFile(`${directory}/render.json`, JSON.stringify(render, null, 2));
  return render;
}
