import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// LAN access: bind all NICs. Do NOT hardcode hmr.host — dual adapters
// (e.g. Ethernet 192.168.1.216 + Wi-Fi 10.152.32.240) break when HMR is pinned
// to one IP while the browser opened the other (or localhost).
const sharedServer = {
  host: '0.0.0.0',
  port: 5174,
  strictPort: true,
  allowedHosts: true,
  hmr: {
    protocol: 'ws',
    // client uses window.location.hostname (localhost / 192.x / 10.x)
    clientPort: 5174,
  },
  watch: {
    usePolling: false,
  },
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:8010',
      changeOrigin: true,
      timeout: 600000,
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
}

export default defineConfig({
  plugins: [react()],
  server: sharedServer,
  preview: sharedServer,
})
