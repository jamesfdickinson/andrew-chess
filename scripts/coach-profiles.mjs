import { replaceFile } from './replace-file.mjs';
import { coachPath } from '../src/coach-paths.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const coachContext = new AsyncLocalStorage();
export const coachId = () => coachContext.getStore() || 'jimmy';
export const coachBase = () => coachPath(coachId());
export const coachDirectory = root => path.join(root, 'public', coachBase());
const defaults = () => [{ id: 'jimmy', name: 'Jimmy', voiceId: '', original: true }];
export async function readCoaches(root) {
  try { return JSON.parse(await readFile(path.join(root, 'public/coach/coaches.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return defaults(); throw error; }
}
const writes = new Map();
export function editCoaches(root, edit) {
  const job = (writes.get(root) || Promise.resolve()).then(async () => {
    const coaches = await readCoaches(root); const result = edit(coaches);
    const target = path.join(root, 'public/coach/coaches.json');
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(coaches, null, 2)); await replaceFile(temp, target);
    return result;
  });
  writes.set(root, job.catch(() => {})); return job;
}
export async function jsonBody(req, limit = 65536) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new Error('Request too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
