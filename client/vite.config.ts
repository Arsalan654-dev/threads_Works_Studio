// `vitest/config` re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the ThreadWorks editor.
 *
 * The app is local-only, so the dev server binds loopback and proxies `/api`
 * to the Express process. Proxying (rather than letting the client call
 * `127.0.0.1:4000` directly) keeps the browser on a single origin, which
 * means no CORS preflight on every request and no mixed-content surprises
 * if the ports ever move.
 */
const API_HOST = process.env.VITE_SERVER_HOST ?? '127.0.0.1';
const API_PORT = Number(process.env.VITE_SERVER_PORT ?? 4000);
const CLIENT_PORT = Number(process.env.VITE_CLIENT_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${API_HOST}:${API_PORT}`,
        changeOrigin: false,
      },
      '/exports': {
        target: `http://${API_HOST}:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: CLIENT_PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Designs are local; a chunk budget keeps the editor from shipping a
    // multi-megabyte bundle before the first paint.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
