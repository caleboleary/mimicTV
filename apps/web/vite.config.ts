import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** The service owns state, imports, scanning, publishing, and live breaks. In dev, proxy to it. */
const SERVER = process.env.MIMICTV_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mimictv/core/schema/playout': path.resolve(__dirname, '../../packages/core/schema/playout-0.0.3.json'),
      '@mimictv/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': SERVER, '/imports': SERVER, '/dynamic': SERVER },
  },
});
