import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { coachDirectory, coachBase, coachId } from './coach-profiles.mjs';
import { localVideoPath, runFFmpeg } from './video-processing.mjs';

export async function coreReference(root) {
  const directory = path.join(coachDirectory(root), 'references');
  try { return JSON.parse(await readFile(path.join(directory, 'active.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (coachId() !== 'jimmy') return { id: createHash('sha256').update(coachId()).digest('hex').slice(0, 12), image: null, pending: true, name: 'Approve core artwork first' };
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const references = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try { references.push(JSON.parse(await readFile(path.join(directory, entry.name, 'reference.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return references.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || { id: 'original', image: null, name: 'Original Jimmy illustration' };
}
export async function coreReferenceBytes(root, reference) {
  return readFile(reference?.image ? localVideoPath(root, reference.image) : path.join(root, 'public/coach/jimmy/artwork/jimmy-pawn-proud-sheet.png'));
}
export async function saveCoreReference(root, bytes) {
  const base = `${coachBase()}/references/${randomUUID()}`, directory = localVideoPath(root, base);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'uploaded-image'), bytes);
  await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', path.join(directory, 'uploaded-image'), '-frames:v', '1', '-vf', "scale=w='min(1536,iw)':h=-2", path.join(directory, 'reference.png')]);
  const normalized = await readFile(path.join(directory, 'reference.png'));
  const reference = { id: createHash('sha256').update(normalized).digest('hex').slice(0, 12), image: `${base}/reference.png`, name: 'Uploaded coach reference', createdAt: new Date().toISOString() };
  await writeFile(path.join(directory, 'reference.json'), JSON.stringify(reference));
  return reference;
}
export const frameSetKey = (performanceId, referenceId) => referenceId && referenceId !== 'original' ? `${performanceId}-ref-${referenceId}` : performanceId;
