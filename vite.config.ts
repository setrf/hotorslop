import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env?: Record<string, string | undefined> }

const API_PROXY_TARGET = process?.env?.VITE_DEV_SERVER_API ?? 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
