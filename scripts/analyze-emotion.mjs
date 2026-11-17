import { access, readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localVideoPath } from './video-processing.mjs';
export const emotionPython = root => path.join(root, '.emotion/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export async function emotionStatus(root) {
  try {
    await access(emotionPython(root));
    await access(path.join(root, '.emotion/models/emotion2vec-plus-large/model.pt'));
    const status = JSON.parse(await readFile(path.join(root, '.emotion/ready.json'), 'utf8'));
    return { ready: status.ready === true, model: status.model, revision: status.revision, device: status.device, cudaAvailable: status.cudaAvailable };
  } catch { return { ready: false, message: 'Run npm run emotion:setup to install local vocal-emotion analysis.' }; }
}

// Bound inference windows even when a user merged the timeline into one long row.
export function emotionWindows(duration, transcript) {
  const windows = [];
  for (let start = 0; start < duration; start += 3) {
    const end = Math.min(duration, start + 3);
    windows.push({ start, end, hasSpeech: (transcript?.words ?? []).some(word => word.start < end && word.end > start) });
  }
  return windows;
}

async function workerLock(root) {
  const filename = path.join(root, '.emotion/worker.lock');
  await mkdir(path.dirname(filename), { recursive: true });
  // Exclusive across the server and CLI. Recover only a lock owned by a dead process.
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      const handle = await open(filename, 'wx');
      await handle.writeFile(String(process.pid));
      return async () => { await handle.close(); await unlink(filename).catch(() => {}); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = Number(await readFile(filename, 'utf8'));
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); } catch (check) { if (check.code === 'ESRCH') { await unlink(filename).catch(() => {}); continue; } }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Another local emotion job is still running. Try again later.');
}

export async function analyzeEmotion(root, audio, output, { duration, transcript }) {
  if (!(await emotionStatus(root)).ready) return { status: 'unavailable', modality: 'audio', segments: [], message: 'Run npm run emotion:setup.' };
  const segmentsFile = output.replace(/\.json$/, '-windows.json');
  await writeFile(segmentsFile, JSON.stringify(emotionWindows(duration, transcript), null, 2));
  const unlock = await workerLock(root);
  try {
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const child = spawn(emotionPython(root), [path.join(root, 'scripts/emotion/analyze.py'), '--audio', audio, '--segments', segmentsFile, '--output', output], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONIOENCODING: 'utf-8', HF_HOME: path.join(root, '.emotion/cache/huggingface') },
      });
      let stderr = '', timedOut = false;
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(timedOut ? 'Emotion analysis exceeded ten minutes.' : `Local emotion analysis failed: ${stderr}`)); });
    });
    const result = JSON.parse(await readFile(output, 'utf8'));
    result.workerSeconds = +((performance.now() - started) / 1000).toFixed(3);
    await writeFile(output, JSON.stringify(result, null, 2));
    return result;
  } finally { await unlock(); }
}

export async function addEmotionPass(root, analysis, { progress = async () => {}, inferEmotion = analyzeEmotion } = {}) {
  await progress('Estimating vocal emotion; keeping transcript and timeline edits');
  const revision = randomUUID();
  const output = localVideoPath(root, `/coach/shared/analysis/${analysis.id}/emotions-${revision}.json`);
  const emotions = await inferEmotion(root, localVideoPath(root, analysis.audio), output, analysis);
  if (emotions.status !== 'complete') throw new Error(emotions.message || 'Emotion analysis is not ready.');
  await writeFile(output, JSON.stringify(emotions, null, 2));
  return { ...analysis, revision, emotions, emotionParentRevision: analysis.revision, emotionUpdatedAt: new Date().toISOString(),
    timeline: analysis.timeline.map(segment => ({ ...segment, note: segment.note.replace(
      'Expression comes from phrase configuration; video performance has not been interpreted.',
      'Vocal-emotion suggestions are available; this animation was retained. Facial expressions and gestures have not been analyzed.') })) };
}
