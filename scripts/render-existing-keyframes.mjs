import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { prepareKeyframes, renderKeyframes } from './keyframe-recording.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { localVideoPath } from './video-processing.mjs';
const root = process.cwd();
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Name the phrase IDs to render.');
for (const id of ids) {
  const saved = (await readRecordings(root))[id];
  if (!saved?.original) throw new Error(`No recording for ${id}`);
  const previous = saved.keyframes;
  const manifest = previous ? JSON.parse(await readFile(localVideoPath(root, previous.url), 'utf8')) : await prepareKeyframes(root, id, saved, { progress: console.log });
  const result = await renderKeyframes(root, manifest, manifest.selected, { progress: stage => console.log(id, stage) });
  const revision = randomUUID();
  const updated = { ...manifest, revision, renders: [...manifest.renders, result], activeRender: result.id, status: 'rendered' };
  const url = `/coach/shared/keyframes/${manifest.id}/revision-${revision}.json`;
  await writeFile(localVideoPath(root, url), JSON.stringify(updated, null, 2));
  let attached = false;
  await updateRecordings(root, recordings => {
    if (recordings[id]?.original !== saved.original || JSON.stringify(recordings[id]?.keyframes) !== JSON.stringify(previous)) return;
    recordings[id].keyframes = { id: manifest.id, url, revision }; attached = true;
  });
  console.log(attached ? 'Preview ready:' : 'Take changed; result retained:', result.video);
}
