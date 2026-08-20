import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bound explicitly to IPv4. On Windows "localhost" can resolve to ::1 while
    // the waiter probes 127.0.0.1, and `npm run dev` then hangs forever waiting
    // for a server that is already up.
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome124',
    // Older laptops: keep the bundle small and skip expensive source maps in prod.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
