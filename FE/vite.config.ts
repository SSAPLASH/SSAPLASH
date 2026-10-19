import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // '@/' = src/. tsconfig.app.json paths · vitest.config.ts와 같이 맞춘다
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
