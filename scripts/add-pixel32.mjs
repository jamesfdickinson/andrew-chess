import { fileURLToPath } from 'node:url';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { processPixel32 } from './video-processing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [id, recording] of Object.entries(await readRecordings(root))) {
  if (!recording.original || recording.variants?.pixel32) continue;
  const pixel32 = await processPixel32(root, recording.original);
  await updateRecordings(root, current => {
    if (current[id]?.original !== recording.original) return;
    current[id].variants = { ...current[id].variants, pixel32 };
  });
  console.log(`Added 32 × 32: ${id}`);
}
