import { mediaFile } from './media-paths.mjs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { coachContext, coachBase } from './coach-profiles.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { readFrameSets } from './frame-sets.mjs';
import { portraitPresets } from '../src/portrait-config.js';
import { runFFmpeg } from './video-processing.mjs';
import { sheetFiles as sourceSheets } from '../src/coach-artwork.js';

const root = process.cwd();
const requestedCoach = process.argv[2];
const requestedPhrase = process.argv[3];
for (const coachId of ['jimmy', 'andrew'].filter(id => !requestedCoach || requestedCoach === id)) {
  await coachContext.run(coachId, async () => {
    const base = coachBase(), directory = mediaFile(root, base + '/' + 'animated-voice-clips');
    const cache = path.join(root, 'tmp', 'voice-animation-frames', coachId);
    await mkdir(directory, { recursive: true }); await mkdir(cache, { recursive: true });
    await readFrameSets(root);
    const saved = await readRecordings(root), readyFrames = new Set();
    let count = 0;
    for (const [id, take] of Object.entries(saved)) {
      if (requestedPhrase && id !== requestedPhrase) continue;
      if (!/\/voice-fill-[a-z0-9-]+\//.test(take.original || '') || take.animation?.source !== take.original) continue;
      const analysis = JSON.parse(await readFile(mediaFile(root, take.analysis.url)));
      const signature = createHash('sha256').update(JSON.stringify([take.original, take.animation, 20, 480])).digest('hex').slice(0, 12);
      const name = `${id}-${signature}.mp4`, output = path.join(directory, name);
      if (take.animationExport?.signature === signature) { try { await access(output); count++; continue; } catch {} }
      const frames = [], cues = take.animation.cues;
      let cueIndex = 0;
      for (let n = 0; n < Math.ceil(analysis.duration * 20); n++) {
        const at = n / 20;
        while (cueIndex + 1 < cues.length && cues[cueIndex + 1].at <= at) cueIndex++;
        const cue = cues[cueIndex];
        const preset = portraitPresets[cue.emotion];
        if (!preset) throw new Error(`Unknown frame preset ${cue.emotion}`);
        const elapsed = Math.max(0, at - (cue.segmentStart || 0));
        const row = preset.gesture ? preset.gesture[Math.floor(elapsed / preset.step)] ?? preset.row : preset.row;
        const column = preset.columns ? preset.columns[Math.floor(elapsed / preset.step)] ?? preset.restingColumn : cue.mouth ?? 0;
        const rows = preset.rows || 4;
        const source = preset.image ? path.join(root, 'public', preset.image.split('?')[0]) : path.join(root, 'public/coach/jimmy/artwork', sourceSheets[preset.sheet]);
        const frameKey = createHash('sha256').update(`${source}:${row}:${column}:${rows}`).digest('hex').slice(0, 20);
        const frame = path.join(cache, frameKey + '.png');
        if (!readyFrames.has(frameKey)) {
          try { await access(frame); } catch {
            await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', source, '-frames:v', '1', '-vf',
              `crop=iw/3:ih/${rows}:iw*${column}/3:ih*${row}/${rows},scale=480:480:flags=neighbor,setsar=1`, frame]);
          }
          readyFrames.add(frameKey);
        }
        frames.push(frame.replaceAll('\\', '/'));
      }
      const concatFile = path.join(cache, `${id}.ffconcat`);
      await writeFile(concatFile, 'ffconcat version 1.0\n' + frames.map(f => `file '${f}'\nduration 0.05`).join('\n') + `\nfile '${frames.at(-1)}'\n`);
      try { await access(output); } catch {
        await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-safe', '0', '-f', 'concat', '-i', concatFile,
          '-i', mediaFile(root, take.original), '-map', '0:v:0', '-map', '1:a:0', '-t', String(analysis.duration),
          '-r', '20', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]);
      }
      await updateRecordings(root, current => {
        if (current[id]?.original !== take.original || current[id]?.animation?.revision !== take.animation.revision) return;
        current[id].animationExport = { source: take.original, video: `${base}/animated-voice-clips/${name}`, signature, fps: 20, width: 480, height: 480 };
      });
      count++; console.log(coachId, 'EXPORTED', id);
    }
    const latest = await readRecordings(root);
    await writeFile(path.join(directory, 'index.json'), JSON.stringify(Object.entries(latest).filter(([,v]) => v.animationExport?.source === v.original).map(([id,v]) => ({ id, text: v.generatedText, ...v.animationExport })), null, 2));
    console.log(coachId, 'Playable animations:', count);
  });
}
