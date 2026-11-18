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
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            // 라이브러리를 앱 코드와 따로 묶어, 배포마다 앱 코드만 바뀌어도 vendor 파일 해시가 유지되게 한다 (브라우저 캐시 재사용)
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|zustand)[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor-motion',
                test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
                priority: 10,
                // motionFeatures(domMax)는 동적 import라 지연 청크로 남겨야 한다. $initial(entry에서 정적으로 닿는 모듈)만 잡아 지연 기능 코드가 첫 로드로 끌려오지 않게 한다
                tags: ['$initial'],
              },
            ],
          },
        },
      },
    },
    server: {
      // BE 호출은 같은 출처로 간다. /api를 BE(기본 8080)로 넘기면 운영(Nginx)처럼 CORS 없이 refresh 쿠키가 실린다
      proxy: { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080' } },
    },
  }
})
