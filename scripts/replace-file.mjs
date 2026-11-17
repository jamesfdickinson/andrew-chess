import { rename } from 'node:fs/promises';

// Windows can briefly deny replacement while Vite or an index reader holds
// the file open. Retain atomic publication and retry that transient lock.
export async function replaceFile(source, target, { move = rename, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await move(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 39) throw error;
      await delay(25);
    }
  }
}
