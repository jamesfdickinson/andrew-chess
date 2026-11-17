import { coachAsset } from './coach-session.js';
import { portraitPresets } from './portrait-config.js';

export function registerGeneratedSets(assets) {
  for (const asset of assets || []) {
    if (asset.status !== 'approved' || !/^generated-[a-z0-9-]+$/.test(asset.setId) ||
        !/^[a-z0-9-]+$/.test(asset.key) ||
        !new RegExp(`^/coach/[a-z0-9-]+/frame-sets/${asset.key}/sheet\\.png$`).test(asset.image)) continue;
    portraitPresets[asset.setId] = { sheet: asset.setId, image: asset.revision ? `${asset.image}?v=${encodeURIComponent(asset.revision)}` : asset.image, row: 0, rows: 2, label: asset.name,
      ...(asset.speaking ? { gesture: [0, 0, 1, 1, 0], step: .5 } : { columns: [0, 1, 2, 1, 0], step: .35, restingColumn: 0 }) };
  }
}
export async function loadGeneratedSets() {
  try {
    const response = await fetch(coachAsset('frame-sets.json'), { cache: 'no-store' });
    if (response.ok) registerGeneratedSets(await response.json());
  } catch { /* Existing built-in artwork remains available offline. */ }
}
