import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { audioFile, filesUnder, optionalJson, publicFile } from './playback-assets.mjs';
import { coachContext, coachBase } from './coach-profiles.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';

const root = process.cwd();
await mkdir(path.join(root, 'raw-media'), { recursive: true });
const report = { converted: [], silent: [], failed: [] };
const videos = (await Promise.all(['public', 'raw-media', 'media-originals'].map(folder => filesUnder(path.join(root, folder))))).flat()
  .filter(file => /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file));
const converted = new Map();
for (const file of videos) {
  try {
    const audio = await audioFile(root, file);
    converted.set(file, audio);
    report.converted.push({ video: path.relative(root, file), audio: path.relative(root, audio) });
  } catch (error) {
    const entry = { video: path.relative(root, file), error: error.message };
    if (/matches no streams|does not contain any stream/.test(error.message)) report.silent.push(entry);
    else report.failed.push(entry);
  }
  if ((report.converted.length + report.silent.length + report.failed.length) % 50 === 0) console.log(`Checked ${report.converted.length + report.silent.length + report.failed.length}/${videos.length} videos`);
}
const profiles = await optionalJson(publicFile(root, '/coach/coaches.json'), [{ id: 'jimmy' }]);
for (const { id } of profiles) await coachContext.run(id, async () => {
  const recordings = await readRecordings(root);
  const updates = {};
  for (const [phrase, saved] of Object.entries(recordings)) {
    if (!saved.original) continue;
    const file = converted.get(publicFile(root, saved.original));
    if (!file) continue;
    const url = `${coachBase()}/audio/${path.basename(file)}`;
    await mkdir(path.dirname(publicFile(root, url)), { recursive: true });
    await copyFile(file, publicFile(root, url));
    updates[phrase] = { source: saved.original, url };
  }
  await updateRecordings(root, current => {
    for (const [phrase, audio] of Object.entries(updates)) if (current[phrase]?.original === audio.source) current[phrase].audio = audio;
  });
});
await writeFile(path.join(root, 'media-originals', 'audio', 'conversion-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ converted: report.converted.length, silent: report.silent.length, failed: report.failed.length }));
if (report.failed.length) process.exitCode = 1;
