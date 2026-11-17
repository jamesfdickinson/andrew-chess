import { mediaFile } from './media-paths.mjs';
import { coachPath } from '../src/coach-paths.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FishSpeechClient } from './fish-speech-client.mjs';
import { runFFmpeg } from './video-processing.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';

const root = process.cwd(), coachId = 'andrew';
const directory = mediaFile(root, coachPath(coachId) + '/voice-pilot-v1');
await mkdir(directory, { recursive: true });
const recordings = JSON.parse(await readFile(path.join(root, 'public', coachPath(coachId), 'recordings.json')));
const references = [
  { id: 'idle-01', start: .55, end: 4.12, text: 'Take your time. Can any of your pieces take a pawn?' },
  { id: 'idle-02', start: .39, end: 4.04, text: "I'm here when you're ready. Those pawns aren't going to take themselves." },
  { id: 'idle-04', start: .2, end: 4.33, text: 'I see you. Actually, I always see you.' },
];
const referencePath = path.join(directory, 'reference.wav');
try { await readFile(referencePath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const inputs = references.flatMap(r => ['-i', mediaFile(root, recordings[r.id].original)]);
  const filters = references.map((r,i) => `[${i}:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono[a${i}]`);
  filters.push('[a0][a1][a2]concat=n=3:v=0:a=1,loudnorm=I=-20:TP=-2:LRA=11[out]');
  await runFFmpeg(['-hide_banner','-loglevel','error','-nostdin','-n',...inputs,'-filter_complex',filters.join(';'),'-map','[out]','-ar','24000','-c:a','pcm_s16le',referencePath]);
}
const text = references.map(r => r.text).join(' '), voiceId = 'andrew-pilot-v1';
await writeFile(path.join(directory, 'reference.txt'), text);
const manifestPath = path.join(directory, 'manifest.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath)); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  manifest = { coachId, voiceId, references, transcriptStatus: 'Provisional: ASR plus script corrections; listening review required', createdAt: new Date().toISOString(), clips: [] };
}
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await save();
const client = new FishSpeechClient('http://192.168.1.84:8080');
const listed = await client.listReferences();
if (!listed.reference_ids?.includes(voiceId)) {
  const result = await client.addReference({ id: voiceId, audio: new Blob([await readFile(referencePath)], { type: 'audio/wav' }), text });
  if (result?.success === false) throw new Error(JSON.stringify(result));
  console.log('Reference saved', voiceId);
}
for (const id of ['default-01','pawn-takes-piece-02','missed-pawn-02','default-02','review-0-01']) {
  if (manifest.clips.some(c => c.id === id && c.status === 'complete')) continue;
  const phrase = recordingPhrases.find(p => p.id === id);
  if (!phrase || recordings[id]?.original) throw new Error('Pilot requires an existing phrase with no recording: ' + id);
  console.log('Generating', id);
  const started = Date.now();
  const audio = await client.generate({ text: phrase.text, referenceId: voiceId, seed: 42 });
  const raw = path.join(directory, id + '-provider.wav'), output = path.join(directory, id + '.wav');
  await writeFile(raw, audio);
  await runFFmpeg(['-hide_banner','-loglevel','error','-nostdin','-n','-i',raw,'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',output]);
  manifest.clips.push({ id, text: phrase.text, filename: id + '.wav', status: 'complete', secondsToGenerate: (Date.now()-started)/1000, seed: 42 });
  await save(); console.log('Saved', id, manifest.clips.at(-1).secondsToGenerate);
}
console.log('Five pilot clips ready for listening review:', directory);
