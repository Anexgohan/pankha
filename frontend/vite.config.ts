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
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          configure: (proxy) => {
            // Silence proxy errors in console during startup
            proxy.on('error', (err, _req, res) => {
              if (err.message.includes('ECONNREFUSED')) {
                if (res && 'writeHead' in res) {
                   res.writeHead(503, { 'Content-Type': 'text/plain' });
                   res.end('Backend starting...');
                }
                return;
              }
            });
          }
        },
        '/websocket': {
          target: `ws://127.0.0.1:${backendPort}`,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              if (err.message.includes('ECONNREFUSED')) return;
            });
          }
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Keep React engine in the main bundle for maximum stability in Docker
            // Only split out heavy, non-critical libraries
            if (id.includes('node_modules')) {
              if (id.includes('recharts') || id.includes('d3')) return 'vendor-charts';
              if (id.includes('lucide-react')) return 'vendor-icons';
            }
          }
        }
      }
    }
  }
})
