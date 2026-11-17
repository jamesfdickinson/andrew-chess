import { rawMediaPlugin } from './scripts/media-paths.mjs';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { recordingServer } from './scripts/recording-server.mjs';
import { playbackAssets } from './scripts/playback-assets.mjs';
import { chessPwa } from './scripts/pwa.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({ mode }) => {
const tunnelOrigin = process.env.COACH_TUNNEL_ORIGIN || loadEnv(mode, root, 'COACH_TUNNEL_ORIGIN').COACH_TUNNEL_ORIGIN;
const tunnel = tunnelOrigin ? new URL(tunnelOrigin) : null;
if (tunnel && (tunnel.protocol !== 'https:' || tunnel.pathname !== '/' || tunnel.search || tunnel.hash || tunnel.username || tunnel.password)) {
  throw new Error('COACH_TUNNEL_ORIGIN must be an HTTPS origin, such as https://your-tunnel.example');
}
return {
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true,
    watch: { ignored: ['**/raw-media/**', '**/media-originals/**', '**/.speech/**', '**/.emotion/**', '**/tmp/**', '**/archive/**', '**/.codex-attachments/**'] },
    allowedHosts: tunnel ? [tunnel.hostname] : [],
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.speech/**', '**/.emotion/**'] },
  },
  optimizeDeps: { noDiscovery: true, include: ['chess.js'], entries: [] },
  plugins: [rawMediaPlugin(root), playbackAssets(root), chessPwa(new URL('.', import.meta.url)), {
    name: 'local-coach-recordings',
    hotUpdate({ file }) {
      // Notice new public clips without reloading a studio during a take.
      if (file.replaceAll('\\', '/').includes('/public/coach/')) return [];
    },
    configureServer(server) {
      server.middlewares.use(recordingServer(root, { tunnelOrigin: tunnel?.origin }));
    },
  }],
  build: { copyPublicDir: false, rollupOptions: { input: { game: 'index.html', studio: 'studio.html' } } },
};
});
