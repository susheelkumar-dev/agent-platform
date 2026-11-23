import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The preview renders displays with the real framework templates: the same source extjs-migrate copies into apps.
const framework = fileURLToPath(new URL('../agents/extjs-migration-agent/framework/src', import.meta.url));
const service = process.env.UI_FORGE_URL || 'http://127.0.0.1:8140';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: { '@extreact/framework': framework },
    // the framework source lives outside this package: resolve its dependencies from here
    dedupe: ['react', 'react-dom', 'ag-grid-community', 'ag-grid-react', 'write-excel-file'],
  },
  server: { port: 5175, proxy: { '/api': service, '/app-api': service } },
  build: { outDir: '../src/ui_forge/static', emptyOutDir: true, chunkSizeWarningLimit: 4000, sourcemap: false },
  test: { environment: 'jsdom', globals: true },
});
