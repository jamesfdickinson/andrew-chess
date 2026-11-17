import { fileURLToPath } from 'node:url';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { processVideo, readStyle } from './video-processing.mjs';

export async function rebuildVideos(root, log = console.log) {
  const style = await readStyle(root);
  const recordings = await readRecordings(root);
  let completed = 0, failed = 0;
  for (const [id, recording] of Object.entries(recordings)) {
    const original = recording.original || recording.video; // Includes older, unprocessed recordings.
    try {
      const styled = await processVideo(root, original, style);
      await updateRecordings(root, current => {
        // Do not replace a new take uploaded while this old one was processing.
        if ((current[id]?.original || current[id]?.video) === original) current[id] = { ...current[id], original, ...styled, variants: { ...current[id].variants, ...styled.variants }, processingError: null };
      });
      completed++; log(`Styled ${id}`);
    } catch (error) { failed++; log(`Failed ${id}: ${error.message}`); }
  }
  log(`Finished: ${completed} styled, ${failed} failed. Originals and earlier styles preserved.`);
  return { completed, failed };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await rebuildVideos(fileURLToPath(new URL('../', import.meta.url)));
  if (result.failed) process.exitCode = 1;
}
