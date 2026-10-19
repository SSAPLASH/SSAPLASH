// vitest 전용 설정. vite.config.ts와 분리한 이유: vitest가 내장한 vite 버전과 프로젝트 vite 8의 타입이 달라
// 한 파일에 두면 tsc -b가 실패한다. domain·input·engine 순수 로직만 node에서 돌린다.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
