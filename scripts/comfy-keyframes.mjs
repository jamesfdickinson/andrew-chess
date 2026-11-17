import { readFile, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function fluxWorkflow(config, source, reference, prefix) {
  const node = (class_type, inputs) => ({ class_type, inputs });
  return {
    '1': node('UNETLoader', { unet_name: config.model, weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: config.clip, type: 'flux2', device: 'default' }),
    '3': node('VAELoader', { vae_name: config.vae }),
    '4': node('CLIPTextEncode', { clip: ['2', 0], text: config.prompt }),
    '5': node('ConditioningZeroOut', { conditioning: ['4', 0] }),
    '6': node('LoadImage', { image: source }),
    '7': node('VAEEncode', { pixels: ['6', 0], vae: ['3', 0] }),
    '8': node('LoadImage', { image: reference }),
    '9': node('VAEEncode', { pixels: ['8', 0], vae: ['3', 0] }),
    '10': node('ReferenceLatent', { conditioning: ['4', 0], latent: ['7', 0] }),
    '11': node('ReferenceLatent', { conditioning: ['10', 0], latent: ['9', 0] }),
    '12': node('ReferenceLatent', { conditioning: ['5', 0], latent: ['7', 0] }),
    '13': node('ReferenceLatent', { conditioning: ['12', 0], latent: ['9', 0] }),
    '14': node('CFGGuider', { model: ['1', 0], positive: ['11', 0], negative: ['13', 0], cfg: 1 }),
    '15': node('RandomNoise', { noise_seed: config.seed }),
    '16': node('KSamplerSelect', { sampler_name: 'euler' }),
    '17': node('Flux2Scheduler', { steps: config.steps, width: config.size, height: config.size }),
    '18': node('EmptyFlux2LatentImage', { width: config.size, height: config.size, batch_size: 1 }),
    '19': node('SamplerCustomAdvanced', { noise: ['15', 0], guider: ['14', 0], sampler: ['16', 0], sigmas: ['17', 0], latent_image: ['18', 0] }),
    '20': node('VAEDecode', { samples: ['19', 0], vae: ['3', 0] }),
    '21': node('SaveImage', { images: ['20', 0], filename_prefix: prefix }),
  };
}

export class ComfyClient {
  constructor(config) { this.config = config; }
  async request(route, options = {}) {
    const response = await fetch(new URL(route, this.config.server), { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`ComfyUI ${route}: ${response.status} ${(await response.text()).slice(0,600)}`);
    return response;
  }
  async json(route, options) { return (await this.request(route, options)).json(); }
  async upload(file, name) {
    const body = new FormData(); body.append('image', new Blob([await readFile(file)], { type: 'image/png' }), name);
    body.append('type', 'input'); body.append('overwrite', 'false');
    const result = await this.json('/upload/image', { method: 'POST', body });
    return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  }
  async guard() {
    const queue = await this.json('/queue');
    if (queue.queue_running.length || queue.queue_pending.length) throw new Error('ComfyUI has another job. Wait for it to finish, then retry.');
    // Fail closed when the Spark cannot be checked. Never stop another service.
    const { stdout } = await execute('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', this.config.sshHost,
      'nvidia-smi --query-compute-apps=pid --format=csv,noheader,nounits; echo COMFY; docker top comfyui -eo pid'], { windowsHide: true, timeout: 15000 });
    const [gpu, comfy] = stdout.split('COMFY');
    if (comfy === undefined) throw new Error('Could not verify Spark GPU availability.');
    const allowed = new Set(comfy.match(/\b\d+\b/g) || []);
    if ((gpu.match(/\b\d+\b/g) || []).some(pid => !allowed.has(pid))) throw new Error('Another service has a GPU process on the Spark. Finish that work before generating.');
  }
  async lock() {
    // Shared across studio instances and CLI invocations; shell releases on disconnect.
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', this.config.sshHost,
      "flock -n /tmp/andrew-studio-gpu.lock sh -c 'echo LOCKED; cat >/dev/null'"], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Spark GPU lock timed out.')); }, 15000);
      child.stdout.once('data', data => { clearTimeout(timer); data.toString().includes('LOCKED') ? resolve() : reject(new Error('GPU lock unavailable.')); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Another studio generation owns the Spark GPU lock.')); });
    });
    return () => child.stdin.end();
  }
  async generate(workflow, directory, stem) {
    await this.guard();
    await writeFile(`${directory}/${stem}-workflow.json`, JSON.stringify(workflow, null, 2));
    const submitted = await this.json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'andrew-studio' }) });
    if (!submitted.prompt_id) throw new Error('ComfyUI did not accept the workflow.');
    await writeFile(`${directory}/${stem}-prompt.json`, JSON.stringify(submitted));
    // Once submitted, keep ownership until it finishes; a retry must not overlap it.
    for (let attempt = 0; attempt < 1200; attempt++) {
      await sleep(1500);
      const history = await this.json(`/history/${submitted.prompt_id}`);
      const result = history[submitted.prompt_id];
      if (!result) continue;
      await writeFile(`${directory}/${stem}-history.json`, JSON.stringify(result, null, 2));
      if (result.status?.status_str === 'error') throw new Error('ComfyUI generation failed: ' + JSON.stringify(result.status.messages).slice(-900));
      const output = result.outputs?.['21']?.images?.[0];
      if (!output) throw new Error('ComfyUI finished without an image. See saved history.');
      const response = await this.request('/view?' + new URLSearchParams(output));
      await writeFile(`${directory}/${stem}.png`, Buffer.from(await response.arrayBuffer()));
      return;
    }
    throw new Error('ComfyUI is still running. Wait for its queue to finish before retrying.');
  }
}
