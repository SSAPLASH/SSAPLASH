// 모션 토큰·역할 클래스 정적 검사. CSS 파일 텍스트를 읽어 설계(TECH-motion-interaction 3-1·3-2·4-4)와 맞는지 본다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const tokens = read('./tokens.css')
const globalCss = read('./global.css')
const motionCss = read('./motion.css')
// 라이브러리 화면 CSS는 features/studio/components/studio.css에 있다(펄스·하이라이트 허용 항목이 그쪽에 있다)
const studioCss = read('../features/studio/components/studio.css')

/** reduced-motion 미디어 블록 본문(중괄호 짝을 세어 잘라낸다) */
function reducedBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(start).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('reduced-motion 블록이 닫히지 않았다')
}

/** :root 안의 토큰 정의(선언 줄) 값. reduced 블록은 제외하고 첫 정의를 돌려준다 */
function tokenValue(name: string): string | undefined {
  const body = stripComments(tokens).replace(reducedBlock(stripComments(tokens)), '')
  return new RegExp(String.raw`${name}\s*:\s*([^;]+);`).exec(body)?.[1].trim()
}

describe('모션 토큰 (3-1)', () => {
  it.each([
    ['--motion-press', '80ms'],
    ['--motion-fast', '120ms'],
    ['--motion-base', '200ms'],
    ['--ease-out', 'cubic-bezier(0, 0, 0.58, 1)'],
    ['--ease-in-out', 'cubic-bezier(0.42, 0, 0.58, 1)'],
    ['--motion-move', 'var(--motion-base)'],
    ['--motion-fade', 'var(--motion-base)'],
  ])('%s = %s', (name, value) => {
    expect(tokenValue(name)).toBe(value)
  })
})

describe('모션 줄이기 (4-4)', () => {
  const block = reducedBlock(stripComments(tokens))

  it.each(['--motion-press', '--motion-fast', '--motion-move'])('%s를 0ms로 재정의한다', (name) => {
    expect(block).toMatch(new RegExp(String.raw`${name}\s*:\s*0ms`))
  })

  it('--motion-fade는 재정의하지 않는다(투명도 전환 유지)', () => {
    expect(block).not.toContain('--motion-fade')
  })

  it('global.css에 transition: none !important 전역 규칙이 없다', () => {
    expect(stripComments(globalCss)).not.toMatch(/transition\s*:\s*none\s*!important/)
  })
})

describe('motion.css 구성 (3-2)', () => {
  const css = stripComments(motionCss)

  it.each(['motion-overlay', 'motion-dialog', 'motion-menu', 'motion-toast', 'motion-lift'])('.%s 역할 클래스가 있다', (cls) => {
    expect(css).toMatch(new RegExp(String.raw`\.${cls}\s*\{`))
  })

  it.each(['motion-fade-in', 'motion-pop-in', 'motion-drop-in', 'motion-rise-in'])('@keyframes %s가 있다', (name) => {
    expect(css).toMatch(new RegExp(String.raw`@keyframes\s+${name}\s*\{`))
  })

  it('fade-in은 opacity만, pop·drop·rise-in은 transform만 담는다', () => {
    const body = (name: string) => new RegExp(String.raw`@keyframes\s+${name}\s*\{([\s\S]*?\})\s*\}`).exec(css)?.[1] ?? ''
    expect(body('motion-fade-in')).toContain('opacity')
    expect(body('motion-fade-in')).not.toContain('transform')
    for (const name of ['motion-pop-in', 'motion-drop-in', 'motion-rise-in']) {
      expect(body(name)).toContain('transform')
      expect(body(name)).not.toContain('opacity')
    }
  })
})

describe('하드코딩 시간 금지', () => {
  // 허용 목록: 무한 반복 스피너·펄스는 토큰(200ms 기준 UI 전환)과 성격이 달라 고유 주기를 쓰고,
  // studio-just-done은 2초 1회 하이라이트라 마찬가지로 토큰 밖이다. 전환 시간이 아니라 "표현 주기"라서 토큰화하지 않는다.
  const ALLOWED = [
    'animation: spin 0.8s linear infinite',
    'animation: studio-pulse 1.2s var(--ease-in-out) infinite',
    'animation: studio-just-done 2s var(--ease-out)',
    'animation: weak-spin 0.9s linear infinite',
  ]
  const TIME = /(?<![\w.-])(\d+ms|\d*\.\d+s)\b/

  function offenders(css: string): string[] {
    return stripComments(css)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => TIME.test(l) && !ALLOWED.some((a) => l.includes(a)))
  }

  it('global.css에 토큰 밖 시간 리터럴이 없다', () => {
    expect(offenders(globalCss)).toEqual([])
  })

  it('motion.css에 토큰 밖 시간 리터럴이 없다', () => {
    expect(offenders(motionCss)).toEqual([])
  })

  it('studio.css에 토큰 밖 시간 리터럴이 없다', () => {
    expect(offenders(studioCss)).toEqual([])
  })

  it('허용 목록 항목이 실제로 global.css·studio.css에 남아 있다(죽은 허용 항목 방지)', () => {
    const css = stripComments(globalCss) + stripComments(studioCss)
    for (const a of ALLOWED) expect(css).toContain(a)
  })
})
