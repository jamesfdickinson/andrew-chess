import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.speech');
await mkdir(directory, { recursive: true });
const env = { ...process.env, UV_CACHE_DIR: path.join(directory, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: path.join(directory, 'python'), HF_HOME: path.join(directory, 'cache', 'huggingface'), HF_HUB_DISABLE_TELEMETRY: '1' };
const python = path.join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
try {
  let interpreter = process.env.COACH_PYTHON || '3.12';
  if (process.platform === 'win32' && !process.env.COACH_PYTHON && process.env.APPDATA) {
    const existing = path.join(process.env.APPDATA, 'uv/python/cpython-3.12.8-windows-x86_64-none/python.exe');
    try { await access(existing); interpreter = existing; } catch { /* uv installs Python when needed. */ }
  }
  try { await access(python); }
  catch { await run('uv', ['venv', '--python', interpreter, path.join(directory, 'venv')]); }
  await run(python, ['-m', 'ensurepip']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '-r', 'scripts/speech/requirements.txt']);
  await run(python, ['scripts/speech/transcribe.py', '--setup']);
} catch (error) {
  console.error(`Speech setup failed: ${error.message}. Install uv if missing, then rerun npm run speech:setup.`);
  process.exitCode = 1;
}
