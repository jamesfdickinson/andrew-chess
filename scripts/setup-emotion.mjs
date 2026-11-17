import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.emotion');
await mkdir(directory, { recursive: true });
const env = { ...process.env, HF_HOME: path.join(directory, 'cache/huggingface'), HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_XET: '1', PYTHONIOENCODING: 'utf-8', UV_CACHE_DIR: path.join(directory, 'cache/uv') };
const python = path.join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
let interpreter = process.env.COACH_PYTHON || '3.12';
if (process.platform === 'win32' && !process.env.COACH_PYTHON && process.env.APPDATA) {
  const existing = path.join(process.env.APPDATA, 'uv/python/cpython-3.12.8-windows-x86_64-none/python.exe');
  try { await access(existing); interpreter = existing; } catch {}
}
try {
  try { await access(python); } catch { await run('uv', ['venv', '--python', interpreter, path.join(directory, 'venv')]); }
  await run(python, ['-m', 'ensurepip']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', 'torch==2.8.0', 'torchaudio==2.8.0', '--index-url', 'https://download.pytorch.org/whl/cu126']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '-r', 'scripts/emotion/requirements.txt']);
  await run(python, ['scripts/emotion/analyze.py', '--setup']);
} catch (error) { console.error(`Emotion setup failed: ${error.message}. Rerun npm run emotion:setup to retry.`); process.exitCode = 1; }
