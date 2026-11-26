import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { musicPlayerBackend } from './server/backend.js';

export default defineConfig({
  plugins: [react(), musicPlayerBackend()],
  server: {
    // 0.0.0.0 permite abrir o player (e o modo "Ouvir Juntos") em outros aparelhos da rede local
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
