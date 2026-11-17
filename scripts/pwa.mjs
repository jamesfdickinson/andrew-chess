import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function chessPwa(root) {
  return {
    name: 'andrew-chess-pwa', apply: 'build', enforce: 'post',
    async generateBundle(_, bundle) {
      const files = ['manifest.webmanifest', 'icons/favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
      for (const fileName of files) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(new URL(`public/${fileName}`, root)) });
      }
      // Include the engine worker and bundled game code, but not large coach recordings.
      const shell = ['/', '/index.html', '/fonts/andrew-pixel.ttf', ...files.map(name => '/' + name),
        ...Object.keys(bundle).filter(name => name.startsWith('assets/')).map(name => '/' + name)];
      const revision = createHash('sha256');
      for (const item of Object.values(bundle)) revision.update(item.code || item.source || '');
      for (const name of files) revision.update(await readFile(new URL(`public/${name}`, root)));
      const template = await readFile(new URL('src/service-worker.js', root), 'utf8');
      revision.update(template);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template
        .replace('__CACHE_VERSION__', revision.digest('hex').slice(0, 16))
        .replace('__PRECACHE_URLS__', JSON.stringify(shell)) });
    },
  };
}
