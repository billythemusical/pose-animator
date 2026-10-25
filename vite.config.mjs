import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {bridgePlugin} from './sync/bridgePlugin.mjs';

export default defineConfig({
  // Relative asset paths so dist/ works from any folder or file host.
  base: './',
  plugins: [bridgePlugin()],
  server: {
    // Lets a phone on the same wifi open this machine as <name>.local.
    allowedHosts: ['.local'],
  },
  build: {
    sourcemap: false,
    // TF.js alone is ~1MB; a single bundle is fine for a local show.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        panel: fileURLToPath(new URL('./panel.html', import.meta.url)),
      },
    },
  },
});
