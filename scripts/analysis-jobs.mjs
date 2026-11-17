import { replaceFile } from './replace-file.mjs';
import { coachDirectory } from './coach-profiles.mjs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function persistAnalysisJob(root, job) {
  const directory = path.join(coachDirectory(root), 'analysis-jobs');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${job.id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...job, updatedAt: new Date().toISOString() }));
  await replaceFile(temporary, target);
}

export async function listAnalysisJobs(root, recordings) {
  const directory = path.join(coachDirectory(root), 'analysis-jobs');
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const jobs = [];
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const job = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    if (recordings[job.phraseId]?.original !== job.source) continue;
    if (['queued', 'running'].includes(job.status) && Number.isInteger(job.pid)) {
      try { process.kill(job.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { job.status = 'interrupted'; job.stage = 'Analysis interrupted. Select this phrase and analyze again.'; } }
    }
    jobs.push(job);
  }
  const latest = new Map();
  for (const job of jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))) if (!latest.has(job.phraseId)) latest.set(job.phraseId, job);
  return [...latest.values()];
}
