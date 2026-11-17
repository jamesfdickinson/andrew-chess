// Persist each MediaRecorder chunk so navigation/crashes don't discard the take.
import { migrateLegacyDraft } from './legacy-coach-migration.js';
let database;
function openDatabase() {
  return database ??= new Promise((resolve, reject) => {
    // Keep the database name so existing audio chunks are recovered in place.
    const request = indexedDB.open('andrew-studio-drafts', 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore('takes', { keyPath: 'key' });
      else if (event.oldVersion < 2) {
        const cursor = request.transaction.objectStore('takes').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (row.value.kind === 'take') row.update(migrateLegacyDraft(row.value));
          row.continue();
        };
      }
    };
    request.onblocked = () => {
      const error = new Error('Close older studio tabs and reload to recover saved takes.');
      error.name = 'DraftUpgradeBlocked';
      reject(error);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('takes', mode), request = action(tx.objectStore('takes'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function beginDraft(phraseId, mime, coachId = 'jimmy') {
  const id = crypto.randomUUID();
  await transaction('readwrite', store => store.put({ key: id, id, phraseId, mime, coachId, createdAt: Date.now(), kind: 'take' }));
  return id;
}
export async function appendDraft(id, index, blob) {
  await transaction('readwrite', store => store.put({ key: `${id}:${String(index).padStart(6, '0')}`, id, kind: 'chunk', blob }));
}
export async function listDrafts() {
  const entries = await transaction('readonly', store => store.getAll());
  return entries.filter(item => item.kind === 'take').map(meta => {
    const chunks = entries.filter(item => item.kind === 'chunk' && item.id === meta.id).sort((a, b) => a.key.localeCompare(b.key));
    return { ...meta, blob: new Blob(chunks.map(item => item.blob), { type: meta.mime }) };
  }).filter(item => item.blob.size).sort((a, b) => b.createdAt - a.createdAt);
}
export async function removeDraft(id) {
  const entries = await transaction('readonly', store => store.getAllKeys());
  await transaction('readwrite', store => { for (const key of entries) if (key === id || key.startsWith(id + ':')) store.delete(key); });
}
