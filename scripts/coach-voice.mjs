import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { coachBase } from './coach-profiles.mjs';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';
import { FishSpeechClient } from './fish-speech-client.mjs';

const healthCache = new Map();
export async function fishStatus(root, { refresh = false } = {}) {
  const config = await voiceSettings(root);
  const previous = healthCache.get(config.baseUrl);
  if (!refresh && previous && Date.now() - previous.at < 15000) return previous.result;
  const result = (async () => {
    try {
      const health = await new FishSpeechClient(config.baseUrl).health();
      const ready = !['loading', 'starting', 'error', 'unhealthy', 'not_ready'].includes(health?.status) && health?.ready !== false;
      return { ...config, ready, message: ready ? 'Fish Speech Drama 3 is ready.' : 'Fish Speech is still loading its model.' };
    } catch (error) { return { ...config, ready: false, message: error.message }; }
  })();
  healthCache.set(config.baseUrl, { at: Date.now(), result }); return result;
}

export async function voiceSettings(root) {
  let local = {};
  try { local = parseEnv(await readFile(path.join(root, '.env.local'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config = {};
  try { config = JSON.parse(await readFile(path.join(root, '.voice-service.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const baseUrl = process.env.FISH_SPEECH_BASE_URL || local.FISH_SPEECH_BASE_URL || config.baseUrl || 'http://192.168.1.84:8080';
  return { baseUrl, endpoint: baseUrl, environmentOverride: !!(process.env.FISH_SPEECH_BASE_URL || local.FISH_SPEECH_BASE_URL) };
}
export async function generateVoice(root, { text, voiceId, seed }, { fetcher = fetch } = {}) {
  const { baseUrl } = await voiceSettings(root);
  const bytes = await new FishSpeechClient(baseUrl, { fetcher }).generate({ text, referenceId: voiceId, seed, format: 'wav' });
  const base = `${coachBase()}/voice/${randomUUID()}`, directory = localVideoPath(root, base);
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'provider-audio'), bytes);
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', path.join(directory, 'provider-audio'), '-t', '121', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', path.join(directory, 'audio.wav')]);
  const audio = await readFile(path.join(directory, 'audio.wav'));
  if (audio.length > 120 * 24000 * 2 + 100) throw new Error('Generated phrase exceeds two minutes. Shorten it and retry.');
  return { original: `${base}/audio.wav`, mediaType: 'audio', generatedText: text, voiceId, bytes: audio.length, savedAt: new Date().toISOString(), video: null };
}
