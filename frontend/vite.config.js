import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // bind to 0.0.0.0 so other machines on the network can reach it
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8010',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8010',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
