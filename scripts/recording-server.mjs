import { mediaFile } from './media-paths.mjs';
import { coachContext, readCoaches, coachDirectory } from './coach-profiles.mjs';
import { coachStudioServer } from './coach-studio-server.mjs';
import { Readable } from 'node:stream';
import { normalizeAudio } from './audio-recording.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { processVideo } from './video-processing.mjs';
import { readRecordings, updateRecordings } from './recording-store.mjs';
import { recordingPhrases } from '../src/recording-phrases.js';
import { trimRecording } from './trim-recording.mjs';
import { analysisServer } from './analysis-server.mjs';
import { keyframeServer } from './keyframe-server.mjs';
import { videoPerformanceServer } from './video-performance-server.mjs';
import { readFrameSets } from './frame-sets.mjs';

const loopbackHost = host => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

function scopedRecordingServer(root, { processor = processVideo, trimmer = trimRecording, tunnelOrigin, analysisOptions, keyframeOptions, videoPerformanceOptions, coachStudioOptions } = {}) {
  const directory = path.dirname(mediaFile(root, '/coach/shared/originals'));
  const token = randomUUID();
  const tunnel = tunnelOrigin ? new URL(tunnelOrigin) : null;
  const ids = new Set(recordingPhrases.map(phrase => phrase.id));
  let queue = Promise.resolve();
  const handleAnalysis = analysisServer(root, analysisOptions);
  const handleKeyframes = keyframeServer(root, keyframeOptions);
  const handleVideoPerformance = videoPerformanceServer(root, videoPerformanceOptions);
  const handleCoachStudio = coachStudioServer(root, { ...coachStudioOptions, onVoiceSaved: async (id, take, options) => {
    const request = Readable.from([Buffer.from(JSON.stringify({ source: take.original, useAutomatically: options.useAutomatically, autoCreateArtwork: options.autoCreateArtwork }))]);
    request.method = 'POST';
    await handleAnalysis(request, null, new URL(`http://localhost/api/recordings/${id}/analyze`), (code, value) => { if (code >= 400) throw new Error(value.error); });
  } });
  return async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/coach/frame-sets.json') {
      try { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(await readFile(path.join(coachDirectory(root), 'frame-sets.json'), 'utf8')); }
      catch { res.end('[]'); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/coach/recordings.json') {
      try { const saved = await readRecordings(root); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(saved)); }
      catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Recording index unavailable. Retry shortly.' })); }
      return;
    }
    if (!url.pathname.startsWith('/api/recordings')) return next();
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      // Accept only localhost or the explicitly configured tunnel, via a local proxy.
      const host = req.headers[':authority'] ?? req.headers.host ?? '';
      const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const tunnelRequest = tunnel && localProxy && (host === tunnel.host || loopbackHost(host));
      const loopback = loopbackHost(host);
      if (!loopback && !tunnelRequest) return send(403, { error: 'Use the local server address.' });
      const protocol = req.socket.encrypted ? 'https' : 'http';
      if (req.headers.origin && !(loopback && req.headers.origin === `${protocol}://${host}`) && !(tunnelRequest && req.headers.origin === tunnel.origin)) return send(403, { error: 'Recording requests must come from this app.' });
      if (req.method === 'GET' && url.pathname === '/api/recordings') return send(200, { token, recordings: await readRecordings(root) });
      if (req.method !== 'GET' && req.headers['x-recording-token'] !== token) return send(403, { error: 'Refresh the studio and try again.' });
      if (await handleCoachStudio(req, res, url, send)) return;
      await readFrameSets(root); // Register approved dynamic presets before timeline validation.
      if (await handleAnalysis(req, res, url, send)) return;
      if (await handleVideoPerformance(req, res, url, send)) return;
      if (await handleKeyframes(req, res, url, send)) return;
      if (req.method !== 'POST') return send(405, { error: 'Method not supported.' });
      if (req.headers['x-recording-token'] !== token) return send(403, { error: 'Refresh the studio and try again.' });
      const isTrim = url.pathname.endsWith('/trim');
      const id = url.pathname.slice('/api/recordings/'.length).replace(/\/trim$/, '');
      if (!ids.has(id)) return send(400, { error: 'Unknown phrase.' });
      if (isTrim) {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return send(413, { error: 'Trim request is too large.' });
        }
        let range;
        try { range = JSON.parse(body); } catch { return send(400, { error: 'Invalid trim request.' }); }
        if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start || range.end > 120) return send(400, { error: 'Invalid trim range.' });
        const edit = async () => {
          const saved = (await readRecordings(root))[id];
          if (!saved?.original || saved.original !== range.original) return { conflict: true };
          const entry = await trimmer(root, saved, range.start, range.end);
          let conflict = false;
          await updateRecordings(root, recordings => {
            if (JSON.stringify(recordings[id]) !== JSON.stringify(saved)) { conflict = true; return; }
            recordings[id] = entry;
          });
          return conflict ? { conflict: true } : { recording: entry };
        };
        const edited = queue.then(edit);
        queue = edited.catch(() => {});
        const result = await edited;
        return result.conflict ? send(409, { error: 'This clip changed. Refresh and try again.' }) : send(200, result);
      }
      const mime = (req.headers['content-type'] ?? '').split(';')[0];
      const extension = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' }[mime];
      if (!extension) return send(415, { error: 'Choose a supported audio file.' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 100 * 1024 * 1024) { send(413, { error: 'Recording is too large. Keep takes under two minutes.' }); return; }
        chunks.push(chunk);
      }
      if (!bytes) return send(400, { error: 'The recording is empty. Please retake it.' });
      const save = async () => {
        await mkdir(path.join(directory, 'originals'), { recursive: true });
        const filename = `${id}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
        const original = `/coach/shared/originals/${filename}`;
        await writeFile(path.join(directory, 'originals', filename), Buffer.concat(chunks), { flag: 'wx' });
        let entry = { original, video: null, savedAt: new Date().toISOString(), bytes, mediaType: mime.startsWith('audio/') ? 'audio' : 'video', processingError: null };
        if (entry.mediaType === 'audio') entry = { ...entry, ...await normalizeAudio(root, original) };
        // Persist the original first; an encoder failure must never lose a take.
        await updateRecordings(root, recordings => { entry.takes = [...(recordings[id]?.takes || []), ...(recordings[id] ? [{ ...recordings[id], takes: undefined }] : [])]; recordings[id] = entry; });
        // The illustrated workflow uses the original audio/video. Skip legacy
        // stylized video exports so the actor can immediately record the next line.
        if (mime.startsWith('audio/') || url.searchParams.get('originalOnly') === '1') return entry;
        try { entry = { ...entry, ...await processor(root, original) }; }
        catch (error) { console.error('Styling failed:', error.message); entry.processingError = 'Original saved, but styling failed. Run npm run coach:rebuild to retry.'; }
        await updateRecordings(root, recordings => { if (recordings[id]?.original === original) recordings[id] = entry; });
        return entry;
      };
      const saved = queue.then(save);
      queue = saved.catch(() => {});
      return send(200, { recording: await saved });
    } catch (error) { console.error('Recording save failed:', error.message); send(500, { error: 'Could not save locally. Your take is still available to retry or download.' }); }
  };
}

// Each coach owns handlers and an async context, including background jobs.
export function recordingServer(root, options = {}) {
  const handlers = new Map();
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/coach/coaches.json' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(await readCoaches(root))); return;
    }
    if (!url.pathname.startsWith('/api/recordings') && !/^\/coach\/(?:coaches\/)?[a-z0-9-]+\/(recordings|frame-sets)\.json$/.test(url.pathname)) return next();
    const profiles = await readCoaches(root);
    const asset = url.pathname.match(/^\/coach\/([a-z0-9-]+)\/(recordings|frame-sets)\.json$/);
    const legacyAsset = url.pathname.match(/^\/coach\/coaches\/([a-z0-9-]+)\/(recordings|frame-sets)\.json$/);
    const id = asset?.[1] || legacyAsset?.[1] || url.searchParams.get('coach') || 'jimmy';
    if (!/^[a-z0-9-]{1,60}$/.test(id) || !profiles.some(coach => coach.id === id)) {
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Coach not found.' })); return;
    }
    if (asset || legacyAsset) req.url = `/coach/${(asset || legacyAsset)[2]}.json`;
    if (!handlers.has(id)) handlers.set(id, scopedRecordingServer(root, options));
    return coachContext.run(id, () => handlers.get(id)(req, res, next));
  };
}
