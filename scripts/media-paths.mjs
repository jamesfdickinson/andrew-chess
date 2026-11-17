import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';

// URLs stay stable so saved takes, timing, and studio history keep their identity.
export function isRawMedia(url) {
  return /^\/coach\/(?:coaches\/)?[a-zA-Z0-9_-]+\/(?:analysis|keyframes|video-performance|styled|animated-voice-clips|(?:[a-zA-Z0-9_-]+-)?voice-(?:pilot|reference|samples)[a-zA-Z0-9_-]*)(?:\/|$)/.test(url);
}

export function mediaFile(root, url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.includes('\\')) throw new Error('Invalid asset URL');
  const pathname = url.split('?')[0];
  if (pathname.split('/').some(part => part === '..' || part === '.')) throw new Error('Asset outside media folder');
  const base = path.resolve(root, isRawMedia(pathname) ? 'raw-media' : 'public');
  const file = path.resolve(base, '.' + pathname);
  if (!file.startsWith(base + path.sep)) throw new Error('Asset outside media folder');
  return file;
}

export function rawMediaPlugin(root) {
  return {
    name: 'raw-media',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = decodeURIComponent((req.url || '').split('?')[0]);
          if (!isRawMedia(url)) return next();
          if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return; }
          const file = await realpath(mediaFile(root, url));
          const base = await realpath(path.join(root, 'raw-media'));
          if (!file.startsWith(base + path.sep)) throw new Error('Asset outside media folder');
          const info = await stat(file);
          if (!info.isFile()) { res.statusCode = 404; res.end(); return; }
          const types = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain', '.zip': 'application/zip' };
          res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          let start = 0, end = info.size - 1;
          if (req.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (match && (match[1] || match[2])) {
              start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
              end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
            }
            if (!match || !(match[1] || match[2]) || start > end || start < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
              res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
            }
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
          }
          res.setHeader('Content-Length', Math.max(0, end - start + 1));
          if (req.method === 'HEAD' || !info.size) { res.end(); return; }
          const stream = createReadStream(file, { start, end });
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          stream.pipe(res);
        } catch (error) { res.statusCode = error.code === 'ENOENT' ? 404 : 400; res.end('Media unavailable'); }
      });
    },
  };
}
