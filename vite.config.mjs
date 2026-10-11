import {defineConfig} from 'vite';

export default defineConfig({
  // Relative asset paths so dist/ works from any folder or file host.
  base: './',
  build: {
    sourcemap: false,
    // TF.js alone is ~1MB; a single bundle is fine for a local show.
    chunkSizeWarningLimit: 2000,
  },
});
