import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, 'client'),
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
