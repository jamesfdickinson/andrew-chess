import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { coachContext, coachDirectory, coachBase } from './coach-profiles.mjs';
import { coreReference, frameSetKey } from './coach-reference.mjs';
import { approveFrameSet, readFrameSets } from './frame-sets.mjs';
import { performanceById } from '../src/performance-catalog.js';
import { resolveTimelineArtwork } from '../src/performance-matching.js';
import { portraitPresets } from '../src/portrait-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const coach = 'andrew';
const batchDir = path.join(root, 'media-originals/coach-reference/jimmy-parity');
const plan = JSON.parse(await readFile(path.join(batchDir, 'plan.json')));
const generation = JSON.parse(await readFile(path.join(batchDir, 'completed-generation.json')));
await coachContext.run(coach, async () => {
  const reference = await coreReference(root);
  assert.equal(reference.id, '00676e4a1c53', 'Review this batch before importing against a different core.');
  for (const entry of generation.entries) {
    const performance = performanceById[entry.id];
    assert.ok(performance);
    const archive = path.join(batchDir, entry.id + '.png');
    await copyFile(entry.source, archive);
    const bytes = await readFile(archive);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16) / bytes.readUInt32BE(20), 1.5);
    assert.equal(bytes.readUInt32BE(16) % 3, 0);
    assert.equal(bytes.readUInt32BE(20) % 2, 0);
    const key = frameSetKey(entry.id, reference.id);
    const directory = path.join(coachDirectory(root), 'frame-sets', key);
    try { await mkdir(directory); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    await copyFile(archive, path.join(directory, 'sheet.png'));
    await writeFile(path.join(directory, 'request.json'), JSON.stringify({
      coachId: coach, key, performanceId: entry.id, referenceId: reference.id,
      coreReference: reference, name: performance.label, speaking: performance.speaking,
      reference: null, createdAt: new Date().toISOString(), source: 'built-in image_gen batch',
    }, null, 2), { flag: 'wx' });
    await writeFile(path.join(directory, 'request-preview.json'), JSON.stringify({
      tool: generation.tool, prompt: entry.prompt, input_references: generation.references,
    }, null, 2), { flag: 'wx' });
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({
      setId: 'generated-' + key, image: coachBase() + '/frame-sets/' + key + '/sheet.png',
      model: 'built-in image_gen', revision: 'jimmy-parity-v1', usage: null,
      finishedAt: new Date().toISOString(),
    }, null, 2), { flag: 'wx' });
  }
  for (const entry of plan) await approveFrameSet(root, frameSetKey(entry.id, reference.id));
  const assets = await readFrameSets(root);
  const current = assets.filter(asset => asset.currentReference && asset.status === 'approved');
  for (const entry of plan) {
    const asset = current.find(item => item.performanceId === entry.id);
    assert.ok(asset, 'Missing approved set: ' + entry.id);
    assert.ok(portraitPresets[asset.setId], 'Set did not register: ' + entry.id);
    assert.equal(asset.speaking, entry.speaking);
    for (const alias of entry.assets) {
      const resolved = resolveTimelineArtwork([{ start: 0, end: 1, emotion: alias }], assets, reference.id);
      assert.equal(resolved.requirements.length, 0, alias + ' still requests artwork');
      assert.equal(resolved.timeline[0].emotion, asset.setId);
    }
  }
  const gallery = current.filter(a => plan.some(p => p.id === a.performanceId)).map(a => {
    const source = '../../frame-sets/' + a.key + '/sheet.png?v=' + encodeURIComponent(a.revision || '1');
    return `<article><h2>${a.name}</h2><a href="${source}"><img src="${source}" alt="${a.name}: six animation frames" loading="lazy"></a><p>${a.speaking ? 'Talking: closed, partly open, open mouth' : 'Silent gesture progression'}</p></article>`;
  }).join('\n');
  const destination = path.join(coachDirectory(root), 'library.html');
  await writeFile(destination, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coach Andrew frame library</title><style>body{font:16px system-ui;background:#10281e;color:#ebedcd;margin:0;padding:24px}main{max-width:1400px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}article{background:#1d3829;padding:16px;border:1px solid #7a9161;border-radius:8px}h2{font-size:18px}img{width:100%;image-rendering:pixelated}a{color:#e9d77f}p{line-height:1.5}</style><main><h1>Coach Andrew — complete frame library</h1><p>23 performance sets · 138 frames · matching Jimmy's 21 standard performances and 2 additional generated gestures.</p><p><a href="/studio.html?coach=${coach}">Open Andrew's studio</a></p><section class="grid">${gallery}</section></main></html>`);
  console.log(JSON.stringify({ approvedSets: current.length, batchCoverage: plan.length, totalFrames: plan.length * 6, gallery: destination }));
});

