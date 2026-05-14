/*
  LocalizaBus — vite.config.js
  Configuração do Vite, responsável por rodar/buildar o React.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          maps: ['leaflet', 'react-leaflet'],
          motion: ['framer-motion'],
          icons: ['lucide-react'],
          http: ['axios']
        }
      }
    }
  }
})
