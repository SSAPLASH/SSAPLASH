import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env·.env.local의 VITE_API_PROXY_TARGET. 개발 서버 전용이라 빌드 결과에는 들어가지 않는다
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react()],
    resolve: {
      // '@/' = src/. tsconfig.app.json paths · vitest.config.ts와 같이 맞춘다
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // BE 호출은 같은 출처로 간다. /api를 BE(기본 8080)로 넘기면 운영(Nginx)처럼 CORS 없이 refresh 쿠키가 실린다
      proxy: { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080' } },
    },
  }
})
