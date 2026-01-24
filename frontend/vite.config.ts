import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from project root directory to get PANKHA_PORT
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const backendPort = rootEnv.PANKHA_PORT || process.env.PANKHA_PORT || 3143

  return {
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
        '/api': `http://localhost:${backendPort}`,
        '/websocket': {
          target: `ws://localhost:${backendPort}`,
          ws: true
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react')) return 'vendor-react';
              if (id.includes('lucide')) return 'vendor-icons';
              if (id.includes('axios')) return 'vendor-axios';
              return 'vendor-others';
            }
          }
        }
      }
    }
  }
})
