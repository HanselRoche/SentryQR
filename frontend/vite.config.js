import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxying keeps the browser on one origin, so the session cookie is
    // first-party and SameSite=Lax behaves exactly as it will in production.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    // Express serves this directory directly when it exists.
    outDir: 'dist',
    sourcemap: true,
  },
});
