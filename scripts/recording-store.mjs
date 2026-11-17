import { coachDirectory } from './coach-profiles.mjs';
import { readFile, writeFile, rename, unlink, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export async function readRecordings(root) {
  // Windows readers can deny replacement of recordings.json while allowing
  // writes. A durable journal makes the fallback recoverable and readable even
  // if the process exits halfway through updating that locked file.
  try { return JSON.parse(await readFile(path.join(coachDirectory(root), '.recordings.pending.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { return JSON.parse(await readFile(path.join(coachDirectory(root), 'recordings.json'), 'utf8')); }
  catch (error) {
    // A writer may have created the journal after our first lookup.
    if (error instanceof SyntaxError || error.code === 'ENOENT') {
      try { return JSON.parse(await readFile(path.join(coachDirectory(root), '.recordings.pending.json'), 'utf8')); }
      catch (pendingError) { if (pendingError.code !== 'ENOENT') throw pendingError; }
      // The fallback write may also have completed and removed its journal.
      try { return JSON.parse(await readFile(path.join(coachDirectory(root), 'recordings.json'), 'utf8')); }
      catch (retryError) { if (retryError.code === 'ENOENT') return {}; throw retryError; }
    }
    throw error;
  }
}
export async function updateRecordings(root, update, { replace = rename, overwrite = writeFile } = {}) {
  const directory = coachDirectory(root);
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, '.recordings.lock');
  let lock;
  for (let attempt = 0; !lock; attempt++) {
    try { lock = await open(lockPath, 'wx'); }
    catch (error) { if (error.code !== 'EEXIST' || attempt >= 100) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  const target = path.join(directory, 'recordings.json');
  const journal = path.join(directory, '.recordings.pending.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const recordings = await readRecordings(root);
    update(recordings);
    const data = JSON.stringify(recordings, null, 2);
    await writeFile(temporary, data);
    try { await replace(temporary, target); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await rename(temporary, journal);
      // Journal is the committed copy until the public index has been synced.
      // Do not remove it on an interrupted or failed write.
      await overwrite(target, data);
      const file = await open(target, 'r+');
      try { await file.sync(); } finally { await file.close(); }
    }
    await unlink(journal).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return recordings;
  } finally { await unlink(temporary).catch(() => {}); await lock.close(); await unlink(lockPath); }
}
