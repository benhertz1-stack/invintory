import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = { target: 'http://localhost:3001', changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/mcp': api,
      '/oauth': api,
      '/.well-known': api,
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
