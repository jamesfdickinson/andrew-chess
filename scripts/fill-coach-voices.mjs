import { mediaFile } from './media-paths.mjs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { coachContext, coachBase, editCoaches } from './coach-profiles.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { FishSpeechClient } from './fish-speech-client.mjs';
import { runFFmpeg } from './video-processing.mjs';
import { analyzeRecording, transcribe } from './analyze-recording.mjs';
import { coreReference } from './coach-reference.mjs';
import { readFrameSets } from './frame-sets.mjs';
import { resolveTimelineArtwork } from '../src/performance-matching.js';
import { mouthSync, timelineCues, validateTimeline } from '../src/animation-timeline.js';
import { recordingPhrases } from '../src/recording-phrases.js';
import { replaceFile } from './replace-file.mjs';

const root = process.cwd();
const requestedIds = process.argv[3]?.split(',');
if (requestedIds?.some(id => !recordingPhrases.some(phrase => phrase.id === id))) throw new Error('Unknown requested phrase');
async function exists(file) { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
const client = new FishSpeechClient('http://192.168.1.84:8080');
const tones = {
  'out-of-pawns': ['dramatically disappointed', 'determined'],
  'pawn-takes-piece': ['delighted', 'proud'], 'pawn-threatens-piece': ['impressed', 'playfully excited'],
  'queen-for-pawn': ['delighted', 'playfully triumphant'], 'pawn-for-piece': ['disappointed', 'incredulous'],
  'piece-for-pawn': ['pleased', 'proud'], 'pawn-for-pawn': ['pleased', 'encouraging'],
  'advanced-pawn-taken': ['amused', 'pleased'], 'queen-over-pawn': ['incredulous', 'playfully disappointed'],
  'piece-over-pawn': ['disappointed', 'teasing'], 'missed-pawn': ['concerned', 'encouraging'],
  'took-pawn': ['excited', 'proud'], 'check': ['concerned', 'reassuring'],
  'pawn-in-danger': ['concerned', 'urgent'], 'protects-pawn': ['relieved', 'proud'],
  'pawn-protects-piece': ['impressed', 'amused'], 'pawn-setup': ['curious', 'encouraging'],
  'default': ['playful', 'encouraging'], 'lost-pawn': ['sad', 'determined'],
  'pawn-under-attack': ['concerned', 'urgent'], 'idle': ['warm', 'playful'],
  'review-7': ['delighted', 'proud'], 'review-5': ['pleased', 'encouraging'],
  'review-3': ['thoughtful', 'encouraging'], 'review-1': ['slightly disappointed', 'hopeful'],
  'review-0': ['disappointed', 'playfully serious'],
};
function directed(phrase) {
  const [first, second] = tones[phrase.event] || ['warm', 'encouraging'];
  const sentences = phrase.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [phrase.text];
  return sentences.map((sentence, i) => `[${i % 2 ? second : first}] ${sentence.trim()}`).join(' ');
}
for (const coachId of ['jimmy', 'andrew'].filter(id => !process.argv[2] || process.argv[2] === id)) {
  await coachContext.run(coachId, async () => {
    const base = coachBase();
    const referenceDir = mediaFile(root, base + '/' + 'voice-reference');
    const reference = JSON.parse(await readFile(path.join(referenceDir, 'reference.json')));
    const batchDirectory = reference.batchDirectory || 'voice-fill-expressive-v1';
    if (!/^voice-fill-[a-z0-9-]+$/.test(batchDirectory)) throw new Error('Invalid voice batch directory');
    const directory = mediaFile(root, base + '/' + batchDirectory);
    const synthesisText = phrase => reference.delivery === 'natural' ? phrase.text : directed(phrase);
    const refs = await client.listReferences();
    if (!refs.reference_ids?.includes(reference.voiceId)) {
      const result = await client.addReference({ id: reference.voiceId, audio: new Blob([await readFile(path.join(referenceDir, 'reference.wav'))], { type: 'audio/wav' }), text: reference.text });
      if (result?.success === false) throw new Error(JSON.stringify(result));
    }
    await mkdir(directory, { recursive: true });
    const statePath = path.join(directory, 'progress.json');
    let state;
    try { state = JSON.parse(await readFile(statePath)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const saved = await readRecordings(root);
      await writeFile(path.join(directory, 'recordings-before.json'), JSON.stringify(saved, null, 2), { flag: 'wx' });
      state = { coachId, name: reference.coach, voiceId: reference.voiceId, startedAt: new Date().toISOString(),
        items: recordingPhrases.filter(p => !saved[p.id]?.original).map(p => ({ id: p.id, text: p.text, synthesisText: synthesisText(p), status: 'pending' })) };
    }
    if (state.voiceId !== reference.voiceId) throw new Error('This batch belongs to a different reference; choose a new batch directory.');
    if (state.status === 'paused-by-user') {
      console.log(reference.coach, 'is paused pending a better reference; no generation or publication performed.');
      return;
    }
    const persist = async () => { const temp = statePath + '.tmp'; await writeFile(temp, JSON.stringify(state, null, 2)); await replaceFile(temp, statePath); };
    // Include old index entries whose source has disappeared, retaining their metadata as a prior take.
    const currentIndex = await readRecordings(root);
    for (const phrase of recordingPhrases) {
      if (requestedIds && !requestedIds.includes(phrase.id)) continue;
      if (state.items.some(item => item.id === phrase.id)) continue;
      const source = currentIndex[phrase.id]?.original;
      if (!source || !await exists(mediaFile(root, source))) state.items.push({ id: phrase.id, text: phrase.text, synthesisText: synthesisText(phrase), status: 'pending' });
    }
    await persist();
    await editCoaches(root, profiles => { profiles.find(p => p.id === coachId).voiceId = reference.voiceId; });
    const core = await coreReference(root), library = await readFrameSets(root);
    for (const item of state.items) {
      if (requestedIds && !requestedIds.includes(item.id)) continue;
      if (['complete', 'preserved'].includes(item.status)) continue;
      try {
        const current = (await readRecordings(root))[item.id];
        if (current?.original && await exists(mediaFile(root, current.original))) { item.status = 'preserved'; await persist(); continue; }
        const previousSource = current?.original || null;
        if (item.status === 'failed') {
          item.previousAttempts = [...(item.previousAttempts || []), { take: item.take, recognizedText: item.recognizedText, error: item.error }];
          item.attempt = (item.attempt || 1) + 1;
          delete item.take;
          // Keep one direction on retry to avoid an unsuccessful mid-sentence transition.
          const phrase = recordingPhrases.find(p => p.id === item.id);
          item.synthesisText = item.retrySynthesisText || (reference.delivery === 'natural' || item.attempt >= 3 ? item.text : `[${(tones[phrase.event] || ['warm'])[0].replace('dramatically disappointed', 'disappointed')}] ${item.text}`);
        }
        item.status = 'running'; delete item.error; await persist();
        console.log(`${state.name} ${state.items.filter(i => i.status === 'complete').length + 1}/${state.items.length} START ${item.id}`);
        const prefix = item.id + (item.attempt ? `-retry${item.attempt}` : '');
        const file = name => path.join(directory, `${prefix}-${name}`);
        if (!item.take) {
          let raw;
          try { raw = await readFile(file('provider.wav')); } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            raw = await client.generate({ text: item.synthesisText, referenceId: state.voiceId, seed: 42 + (item.attempt || 0) });
            await writeFile(file('provider.wav'), raw, { flag: 'wx' });
          }
          try { await access(file('audio.wav')); } catch {
            await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', file('provider.wav'), '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', file('audio.wav')]);
          }
          item.take = { original: `${base}/${batchDirectory}/${prefix}-audio.wav`, generatedText: item.text,
            synthesisText: item.synthesisText, voiceId: state.voiceId, mediaType: 'audio', bytes: (await readFile(file('audio.wav'))).length,
            savedAt: new Date().toISOString(), video: null };
          await persist();
        }
        const analysis = await analyzeRecording(root, { id: item.id, text: item.text }, item.take, { reviewMedia: false });
        const artwork = resolveTimelineArtwork(analysis.timeline, library, core.id);
        if (!artwork.requirements.length) analysis.timeline = artwork.timeline;
        const analysisUrl = `/coach/shared/analysis/${analysis.id}/analysis.json`;
        await writeFile(mediaFile(root, analysisUrl), JSON.stringify(analysis, null, 2));
        // Recognize actual output independently; synthesis text is not evidence of what was spoken.
        const recognized = await transcribe(root, mediaFile(root, analysis.audio), file('recognized.json'));
        item.recognizedText = recognized.text;
        const normalize = text => text.toLowerCase().replace(/\bupon\b/g, 'a pawn').replace(/\bponds\b/g, 'pawns').replace(/\bpond\b/g, 'pawn').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
        const expected = normalize(item.text), actual = normalize(recognized.text || '');
        const actualSet = new Set(actual);
        item.wordCoverage = expected.filter(word => actualSet.has(word)).length / expected.length;
        if (!actual.length || item.wordCoverage < .80 || actual.length < expected.length * .75 || actual.length > expected.length * 1.5 || analysis.duration > 30) {
          throw new Error(`Output needs review: coverage=${item.wordCoverage.toFixed(2)}; recognized=${recognized.text}`);
        }
        const entry = { ...item.take, analysis: { id: analysis.id, url: analysisUrl, revision: analysis.revision }, mouthSync: mouthSync(analysis) };
        if (!artwork.requirements.length) {
          const timeline = validateTimeline(analysis.timeline, analysis.duration);
          entry.animation = { source: entry.original, analysisId: analysis.id, revision: analysis.revision, spokenText: item.text, automatic: true,
            createdAt: new Date().toISOString(), cues: timelineCues(timeline, analysis.envelope, analysis.duration), endingEmotion: timeline.at(-1).emotion };
        }
        let attached = false;
        await updateRecordings(root, saved => {
          if ((saved[item.id]?.original || null) !== previousSource) return;
          const prior = saved[item.id];
          saved[item.id] = { ...entry, ...(prior ? { takes: [...(prior.takes || []), { ...prior, takes: undefined }] } : {}) }; attached = true;
        });
        item.status = attached ? 'complete' : 'preserved'; item.duration = analysis.duration;
        item.missingArtwork = artwork.requirements.map(r => r.key); await persist();
        console.log(`${state.name} DONE ${item.id} ${analysis.duration.toFixed(2)}s coverage=${item.wordCoverage.toFixed(2)}`);
      } catch (error) { item.status = 'failed'; item.error = error.message; await persist(); console.error(state.name, 'FAILED', item.id, error.message); }
    }
    state.finishedAt = new Date().toISOString(); await persist();
    console.log(state.name, JSON.stringify({ complete: state.items.filter(i => i.status === 'complete').length, failed: state.items.filter(i => i.status === 'failed').map(i => i.id) }));
  });
}
