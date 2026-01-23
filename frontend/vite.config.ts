import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Version injected at build time (from CI/CD or fallback to 'dev')
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || 'dev'),
  },
  server: {
    host: '0.0.0.0', // Allow network access
    port: 5173,      // Explicit port
    open: true,       // Auto-open browser
    proxy: {
      '/api': `http://localhost:${process.env.PANKHA_PORT || 3143}`,
      '/websocket': {
        target: `ws://localhost:${process.env.PANKHA_PORT || 3143}`,
        ws: true
      }
    }
  }
})
