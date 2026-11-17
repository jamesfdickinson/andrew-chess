import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sheetFiles } from '../src/animation-timeline.js';
import { portraitPresets } from '../src/portrait-config.js';
import { localVideoPath } from './video-processing.mjs';

// ZIP "store" entries: media is already compressed. No external archiver required.
export function zipFiles(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const filename = Buffer.from(name); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export async function reviewZip(root, analysis) {
  const directory = localVideoPath(root, `/coach/shared/analysis/${analysis.id}`);
  const files = [];
  for (const name of await readdir(directory)) {
    if (/^(frame-\d+\.jpg|slice-\d+\.(mp4|wav)|audio\.wav|transcript\.json|envelope\.json)$/.test(name)) files.push([name, await readFile(path.join(directory, name))]);
  }
  const sourceName = `source${path.extname(analysis.source)}`;
  files.push([sourceName, await readFile(localVideoPath(root, analysis.source))]);
  for (const filename of Object.values(sheetFiles)) files.push([`catalog/${filename}`, await readFile(path.join(root, 'public/coach/jimmy/artwork', filename))]);
  for (const [name, preset] of Object.entries(portraitPresets)) if (preset.image) files.push([`catalog/${name}.png`, await readFile(localVideoPath(root, preset.image))]);
  const exported = structuredClone(analysis);
  // A saved analysis may predate newly registered expression sets.
  exported.catalog = Object.entries(portraitPresets).map(([emotion, preset]) => ({ emotion, ...preset, image: `catalog/${preset.image ? emotion + '.png' : sheetFiles[preset.sheet]}`, columnMeanings: preset.columns ? 'Gesture sequence; all mouths closed' : '0=closed, 1=partly open, 2=open' }));
  exported.source = sourceName; exported.audio = 'audio.wav';
  for (const frame of exported.frames) frame.image = path.basename(frame.image);
  for (const slice of exported.slices) { slice.video = path.basename(slice.video); slice.audio = path.basename(slice.audio); }
  files.push(['analysis.json', JSON.stringify(exported, null, 2)]);
  if (analysis.emotions) files.push(['emotions.json', JSON.stringify(analysis.emotions, null, 2)]);
  files.push(['timeline.json', JSON.stringify({ schemaVersion: 1, analysisId: analysis.id, source: analysis.source, revision: analysis.revision, spokenText: analysis.spokenText ?? analysis.transcript.text, timeline: analysis.timeline }, null, 2)]);
  files.push(['REVIEW.txt', `Review this recorded performance against catalog sprite sheets. All times are seconds from the included source clip. Screenshots sample once per second; inspect the source or slices for motion and vocal delivery. The transcript is machine output and may be wrong. Expressions may be phrase presets, user edits or local vocal-emotion suggestions. If present, emotions.json contains acoustic class scores and context windows; these scores are uncalibrated estimates, not ground truth. Facial expressions and gestures have not been automatically interpreted.\n\nEdit timeline.json only. Keep analysisId, source and revision. Timeline segments must cover 0 to ${analysis.duration}, join exactly without gaps/overlap, and use catalog emotion names. mouth is "auto" (amplitude-based, not phoneme lip-sync) or 0/1/2. Mark needsReview true and explain missing poses or uncertain matches in note. Use only existing emotion names; describe desired new frames in note. Do not claim a missing gesture matches. Import the returned JSON in the studio, preview, then approve. Raw files and previous revisions remain retained locally.`]);
  return zipFiles(files);
}
