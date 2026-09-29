import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/battle-dome/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
