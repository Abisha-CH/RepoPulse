import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, Vite proxies API routes to the Express backend so the
// browser only ever talks to one origin (:5173). Cookies work because the
// backend pins them to the `localhost` hostname (see auth/session.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/me': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/repos': 'http://localhost:3000',
      '/user': 'http://localhost:3000',
      '/public': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});