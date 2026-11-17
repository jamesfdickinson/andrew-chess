import { replaceFile } from './replace-file.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coachId, coachDirectory, readCoaches, editCoaches, jsonBody } from './coach-profiles.mjs';
import { readArtwork, editArtwork, uploadCoachImage, generateCoreImage, approveCore } from './coach-artwork.mjs';
import { coreReference } from './coach-reference.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { generateVoice, voiceSettings, fishStatus } from './coach-voice.mjs';
import { FishSpeechClient } from './fish-speech-client.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';

const voiceQueues = new Map();
export function coachStudioServer(root, { voice = generateVoice, voiceReadiness = fishStatus, coreImage = generateCoreImage, onVoiceSaved = async () => {} } = {}) {
  let coreRunning = false;
  const active = new Set();
  const jobsFile = () => path.join(coachDirectory(root), 'voice-jobs.json');
  let jobs;
  async function loadJobs() {
    if (!jobs) {
      try { jobs = JSON.parse(await readFile(jobsFile(), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; jobs = []; }
      for (const job of jobs) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.message = 'Server restarted. Check provider activity before retrying.'; }
    }
    return jobs;
  }
  let jobWrites = Promise.resolve();
  const persist = () => {
    const content = JSON.stringify(jobs), target = jobsFile();
    const write = jobWrites.then(async () => {
      await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, content); await replaceFile(temp, target);
    });
    jobWrites = write.catch(() => {}); return write;
  };
  return async (req, res, url, send) => {
    const route = url.pathname.slice('/api/recordings'.length);
    if (!['/coaches', '/profile', '/artwork', '/artwork/upload', '/artwork/generate', '/artwork/approve', '/voice', '/voice/config', '/voice/references', '/voice/references/add', '/voice/defaults', '/voice/generate', '/takes/select'].includes(route)) return false;
    try {
      const profile = (await readCoaches(root)).find(item => item.id === coachId());
      if (req.method === 'GET') {
        if (route === '/coaches') send(200, { coaches: await readCoaches(root), profile });
        else if (route === '/artwork') {
          const data = await readArtwork(root);
          send(200, { ...data, jobs: data.jobs.map(job => !coreRunning && ['queued', 'running'].includes(job.status) ? { ...job, status: 'interrupted', message: 'Server restarted. Check provider activity before retrying.' } : job), reference: await coreReference(root) });
        } else if (route === '/voice') send(200, { ...await voiceReadiness(root, { refresh: url.searchParams.get('refresh') === '1' }), profile, jobs: await loadJobs() });
        else if (route === '/voice/references' || route === '/voice/defaults') {
          const client = new FishSpeechClient((await voiceSettings(root)).baseUrl);
          send(200, route.endsWith('defaults') ? await client.defaults() : await client.listReferences());
        }
        else send(405, { error: 'Method not supported.' });
        return true;
      }
      if (req.method !== 'POST') { send(405, { error: 'Method not supported.' }); return true; }
      if (route === '/voice/references/add') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 30 * 1024 * 1024) throw new Error('Voice reference upload must be under 30 MB.'); chunks.push(chunk); }
        const form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData();
        const id = String(form.get('id') || '').trim(), text = String(form.get('text') || '').trim(), audio = form.get('audio');
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !text || text.length > 10000 || !(audio instanceof Blob) || !audio.size) throw new Error('Supply a voice ID, audio sample, and its exact transcript.');
        const client = new FishSpeechClient((await voiceSettings(root)).baseUrl);
        await client.addReference({ id, text, audio, filename: audio.name });
        await editCoaches(root, coaches => { coaches.find(item => item.id === coachId()).voiceId = id; });
        send(200, { voiceId: id }); return true;
      }
      if (route === '/artwork/upload') {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.headers['content-type'])) throw new Error('Choose PNG, JPEG or WebP.');
        const chunks = []; let total = 0;
        for await (const chunk of req) { total += chunk.length; if (total > 12 * 1024 * 1024) throw new Error('Each image must be under 12 MB.'); chunks.push(chunk); }
        send(200, { upload: await uploadCoachImage(root, Buffer.concat(chunks)) }); return true;
      }
      const data = await jsonBody(req);
      if (route === '/voice/config') {
        if ((await voiceSettings(root)).environmentOverride) throw new Error('FISH_SPEECH_BASE_URL is set in the environment or .env.local. Update that setting instead.');
        const client = new FishSpeechClient(String(data.baseUrl || '').trim());
        await writeFile(path.join(root, '.voice-service.json'), JSON.stringify({ baseUrl: client.baseUrl }, null, 2));
        send(200, await voiceReadiness(root, { refresh: true })); return true;
      }
      if (route === '/coaches' || route === '/profile') {
        const name = String(data.name || '').trim(), voiceId = String(data.voiceId || '').trim();
        if (!name || name.length > 60 || voiceId.length > 200) throw new Error('Enter a coach name (up to 60 characters) and a valid voice ID.');
        const result = await editCoaches(root, coaches => {
          if (route === '/coaches') { const item = { id: randomUUID(), name, voiceId }; coaches.push(item); return item; }
          const item = coaches.find(item => item.id === coachId()); Object.assign(item, { name, voiceId }); return item;
        });
        send(200, { profile: result }); return true;
      }
      if (route === '/artwork/approve') {
        const reference = await approveCore(root, Array.isArray(data.ids) ? [...new Set(data.ids)] : []);
        await editCoaches(root, coaches => { coaches.find(item => item.id === coachId()).reference = reference; });
        send(200, { reference }); return true;
      }
      if (route === '/artwork/generate') {
        if (coreRunning) throw new Error('Core portraits are already being generated.');
        const art = await readArtwork(root);
        const uploads = art.uploads.filter(item => data.uploadIds?.includes(item.id));
        const count = Number(data.count || 3);
        if (!uploads.length || uploads.length > 6 || ![1, 2, 3].includes(count)) throw new Error('Select one to six photos and one to three candidates.');
        const job = { id: randomUUID(), status: 'queued', count, completed: 0, createdAt: new Date().toISOString() };
        coreRunning = true;
        await editArtwork(root, value => { value.jobs.push(job); });
        (async () => {
          try {
            for (let n = 0; n < count; n++) {
              await editArtwork(root, value => { Object.assign(value.jobs.find(item => item.id === job.id), { status: 'running' }); });
              const candidate = await coreImage(root, uploads);
              await editArtwork(root, value => { value.candidates.push(candidate); Object.assign(value.jobs.find(item => item.id === job.id), { completed: n + 1 }); });
            }
            await editArtwork(root, value => { value.jobs.find(item => item.id === job.id).status = 'complete'; });
          } catch (error) { await editArtwork(root, value => { Object.assign(value.jobs.find(item => item.id === job.id), { status: 'failed', message: error.message }); }); }
          finally { coreRunning = false; }
        })().catch(() => { coreRunning = false; });
        send(202, { job }); return true;
      }
      if (route === '/takes/select') {
        if (!recordingPhrases.some(item => item.id === data.phraseId)) throw new Error('Unknown phrase.');
        await updateRecordings(root, recordings => {
          const current = recordings[data.phraseId];
          if (!current || current.original !== data.currentSource) throw new Error('Take changed. Refresh first.');
          const selected = current.takes?.find(item => item.original === data.source);
          if (!selected) throw new Error('Saved take not found.');
          recordings[data.phraseId] = { ...selected, takes: [...current.takes.filter(item => item.original !== data.source), { ...current, takes: undefined }] };
        });
        send(200, { recordings: await readRecordings(root) }); return true;
      }
      if (route === '/voice/generate') {
        if (!profile.voiceId) throw new Error('Save this coach’s cloned voice ID first.');
        const readiness = await voiceReadiness(root);
        if (!readiness.ready) throw new Error(readiness.message || 'Fish Speech is not ready yet.');
        const items = data.items;
        if (!Array.isArray(items) || !items.length || items.length > 30 || items.some(item => !recordingPhrases.some(phrase => phrase.id === item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 3000)) throw new Error('Choose 1–30 phrases with text of up to 3,000 characters each.');
        await loadJobs(); const saved = await readRecordings(root), queued = [];
        for (const item of items) {
          if (active.has(item.id)) continue;
          const job = { id: randomUUID(), phraseId: item.id, text: item.text.trim(), voiceId: profile.voiceId, previousSource: saved[item.id]?.original || null, status: 'queued', createdAt: new Date().toISOString() };
          active.add(item.id); jobs.push(job); queued.push(job);
          const voiceQueue = (voiceQueues.get(root) || Promise.resolve()).then(async () => {
            try {
              if (((await readRecordings(root))[item.id]?.original || null) !== job.previousSource) { job.status = 'superseded'; return; }
              job.status = 'running'; await persist();
              const take = await voice(root, { text: job.text, voiceId: job.voiceId, requestId: job.id });
              await updateRecordings(root, recordings => {
                const current = recordings[item.id];
                if ((current?.original || null) !== job.previousSource) {
                  if (current) current.takes = [...(current.takes || []), take];
                  job.status = 'superseded'; return;
                }
                recordings[item.id] = { ...take, takes: [...(current?.takes || []), ...(current ? [{ ...current, takes: undefined }] : [])] }; job.status = 'complete';
              });
              job.source = take.original;
              if (job.status === 'complete') {
                try { await onVoiceSaved(item.id, take, { useAutomatically: data.useAutomatically === true, autoCreateArtwork: data.autoCreateArtwork === true }); }
                catch { job.message = 'Audio saved. Lip sync needs attention; select this phrase and use Sync lips to retry.'; }
              }
            } catch (error) { job.status = 'failed'; job.message = error.message; }
            finally { active.delete(item.id); await persist(); }
          }).catch(() => { active.delete(item.id); });
          voiceQueues.set(root, voiceQueue);
        }
        await persist(); send(202, { queued }); return true;
      }
      send(405, { error: 'Method not supported.' }); return true;
    } catch (error) { send(400, { error: error.message }); return true; }
  };
}
