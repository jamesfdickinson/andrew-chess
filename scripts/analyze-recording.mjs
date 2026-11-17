import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';
import { makeDraft, sheetFiles } from '../src/animation-timeline.js';
import { portraitPresets } from '../src/portrait-config.js';
import { analyzeEmotion } from './analyze-emotion.mjs';
import { applyEmotionDraft } from '../src/emotion-analysis.js';
import { wordActing } from '../src/word-acting.js';

export const speechPython = root => path.join(root, '.speech', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export async function speechStatus(root) {
  try {
    await access(speechPython(root));
    await access(path.join(root, '.speech/models/base.en/model.bin'));
    return { ready: true, ...JSON.parse(await readFile(path.join(root, '.speech/ready.json'), 'utf8')) };
  } catch { return { ready: false, message: 'Run npm run speech:setup in the project terminal to install local speech recognition.' }; }
}
export async function transcribe(root, audio, output) {
  if (!(await speechStatus(root)).ready) throw new Error('Local speech is not installed. Run npm run speech:setup.');
  await new Promise((resolve, reject) => {
    const child = spawn(speechPython(root), [path.join(root, 'scripts/speech/transcribe.py'), '--audio', audio, '--output', output], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local transcription exceeded 10 minutes. Raw data is preserved.')); }, 600000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Local speech failed: ${stderr}`)); });
  });
  return JSON.parse(await readFile(output, 'utf8'));
}
export function audioEnvelope(pcm) {
  const levels = [];
  for (let offset = 0; offset < pcm.length; offset += 1600) {
    let sum = 0, count = 0;
    for (let i = offset; i + 1 < Math.min(offset + 1600, pcm.length); i += 2) { sum += (pcm.readInt16LE(i) / 32768) ** 2; count++; }
    levels.push(Math.sqrt(sum / Math.max(count, 1)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 0.01;
  return levels.map((rms, index) => ({ at: index / 20, rms, mouth: rms < Math.max(0.008, peak * 0.13) ? 0 : rms > peak * 0.6 ? 2 : 1 }));
}
export async function analyzeRecording(root, phrase, saved, { id = randomUUID(), recognize = transcribe, inferEmotion = analyzeEmotion, voiceEmotions = false, reviewMedia = true, onPreviewReady, progress = async () => {} } = {}) {
  const base = `/coach/shared/analysis/${id}`;
  const directory = localVideoPath(root, base);
  await mkdir(directory, { recursive: true });
  const file = name => path.join(directory, name);
  const url = name => `${base}/${name}`;
  const input = localVideoPath(root, saved.original);
  await progress('Extracting audio');
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input, '-t', '121', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file('audio.wav')]);
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', file('audio.wav'), '-f', 's16le', file('audio.pcm')]);
  const pcm = await readFile(file('audio.pcm'));
  const duration = pcm.length / 32000;
  if (!duration || duration > 120) throw new Error('Analyze requires a clip with audio between 0 and 120 seconds. Trim it first.');
  const envelope = audioEnvelope(pcm);
  await writeFile(file('envelope.json'), JSON.stringify(envelope));
  if (onPreviewReady) {
    const preview = { id, source: saved.original, duration, envelope, timeline: makeDraft(phrase.id, duration, { words: [] }), previewOnly: true };
    await writeFile(file('preview.json'), JSON.stringify(preview));
    await onPreviewReady({ url: url('preview.json') });
  }
  await progress('Transcribing locally');
  const transcript = saved.generatedText ? { text: saved.generatedText, words: [] } : await recognize(root, file('audio.wav'), file('transcript.json'));
  if (saved.mediaType === 'audio') reviewMedia = false;
  // Store raw model output separately from editable timeline revisions.
  await writeFile(file('transcript.json'), JSON.stringify(transcript, null, 2));
  let emotions = { status: 'not-requested', modality: 'audio', segments: [], message: 'Wording-based acting is the default. Vocal-emotion analysis is optional.' };
  if (voiceEmotions) {
    await progress('Estimating vocal emotion locally');
    try { emotions = await inferEmotion(root, file('audio.wav'), file('emotions.json'), { duration, transcript }); }
    catch (error) { emotions = { status: 'failed', modality: 'audio', segments: [], message: error.message }; }
  }
  await writeFile(file('emotions.json'), JSON.stringify(emotions, null, 2));
  await progress('Choosing expressive acting from the words');
  const initial = makeDraft(phrase.id, duration, transcript);
  const timeline = wordActing(voiceEmotions ? applyEmotionDraft(initial, emotions) : initial, { phraseId: phrase.id, text: transcript.text });
  if (reviewMedia) await progress('Extracting screenshots and review clips');
  const frames = [];
  for (let at = 0; reviewMedia && at < duration; at += 1) {
    const name = `frame-${String(at).padStart(3, '0')}.jpg`;
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', file(name)]);
    await access(file(name));
    frames.push({ at, image: url(name) });
  }
  const slices = [];
  for (const [index, segment] of (reviewMedia ? timeline : []).entries()) {
    const name = `slice-${String(index).padStart(3, '0')}`;
    const range = ['-ss', String(segment.start), '-t', String(segment.end - segment.start)];
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input, ...range, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=480:-2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', file(`${name}.mp4`)]);
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', file('audio.wav'), ...range, file(`${name}.wav`)]);
    slices.push({ start: segment.start, end: segment.end, video: url(`${name}.mp4`), audio: url(`${name}.wav`) });
  }
  const analysis = { schemaVersion: 1, id, revision: randomUUID(), phraseId: phrase.id, script: phrase.text, source: saved.original,
    createdAt: new Date().toISOString(), duration, status: 'draft', method: 'Local speech + audio amplitude + wording-based comic acting; vocal-emotion estimates retained as an alternative. No facial or gesture analysis.',
    audio: url('audio.wav'), transcript, envelope, emotions, frames, slices, timeline, reviewMedia,
    catalog: Object.entries(portraitPresets).filter(([, preset]) => !preset.image).map(([emotion, preset]) => ({ emotion, ...preset, image: `catalog/${sheetFiles[preset.sheet]}`, columnMeanings: preset.columns ? 'Gesture sequence; all mouths closed' : '0=closed, 1=partly open, 2=open' })),
  };
  await writeFile(file('analysis.json'), JSON.stringify(analysis, null, 2));
  return analysis;
}
