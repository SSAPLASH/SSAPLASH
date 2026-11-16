import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingView } from './LandingView';

// 모션 줄이기 분기를 바꿔 가며 확인하기 위해 훅만 바꿔 끼운다
const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionState.reduce,
}));

beforeEach(() => {
  motionState.reduce = false;
});

const noop = () => {};
const render = (showLogin: boolean) => renderToStaticMarkup(<LandingView onStart={noop} onMode={noop} showLogin={showLogin} />);

describe('LandingView', () => {
  it('7개 섹션을 순서대로 그린다', () => {
    const html = render(true);
    const ids = ['hero', 'statement', 'stick', 'ai', 'modes', 'result', 'start'];
    const positions = ids.map((id) => html.indexOf(`id="${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('루트 .lp 아래에 그려진다', () => {
    // 워드마크 이미지 때문에 React가 preload 링크를 맨 앞에 끌어올린다. 그 뒤가 곧바로 루트다
    expect(render(true).replace(/^(<link [^>]*\/>)+/, '')).toMatch(/^<div class="lp">/);
  });

  it('상단 바 로고는 워드마크 이미지이고 이름을 alt로 읽어 준다', () => {
    expect(render(true)).toMatch(/<a class="lp-logo" href="#hero"><img src="\/images\/ssaplash-wordmark\.webp" alt="SSAPLASH"/);
  });

  it('모드 3개가 히어로와 모드 섹션에 각각 있고 단축키가 붙는다', () => {
    const html = render(true);
    expect(html.match(/aria-label="(자유|악보|게임) 모드로 시작"/g)).toHaveLength(6);
    expect(html).toContain('aria-keyshortcuts="1"');
    expect(html).toContain('aria-keyshortcuts="3"');
    expect(html).toContain('/landing/sheet.jpg');
  });

  it('showLogin이면 헤더 로그인 버튼과 CTA 버튼이 있다', () => {
    const html = render(true);
    expect(html).toContain('>로그인</button>');
    expect(html).toContain('로그인하고 시작하기');
  });

  it('showLogin이 false면 헤더 로그인 버튼 자리를 비운다(CTA는 남는다)', () => {
    const html = render(false);
    expect(html).not.toContain('>로그인</button>');
    expect(html).toContain('lp-nav-slot');
    expect(html).toContain('로그인하고 시작하기');
  });

  it('연출 모드: 장면이 sticky 구조이고 채보 탭은 표시용(음원부터), 스틱 진행 막대가 있다', () => {
    const html = render(true);
    expect(html).toContain('lp-sticky');
    expect(html).not.toContain('lp-static');
    expect(html).toContain('<span class="lp-on">음원</span>');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('lp-progress');
    expect(html).toContain('lp-wipe');
    // 스틱 그림은 캔버스(장식이라 스크린리더에서 숨김)
    expect(html).toMatch(/<canvas[^>]*aria-hidden="true"/);
    // 초기 진행도 0: 스틱 첫 단계만 켜짐
    expect(html.match(/class="lp-step lp-on"/g)).toHaveLength(1);
    expect(html).toContain('드럼을 칠 수 있다면.');
    expect(html).toContain('lp-stat lp-acc');
    expect(html).toContain('lp-stat lp-weak');
  });

  it('모션 줄이기: 장면이 풀려 최종 상태(채보 탭 클릭형, 단계 글 모두 밝게, 네온 켜짐, 와이프 없음)', () => {
    motionState.reduce = true;
    const html = render(true);
    expect(html).toContain('lp-static');
    expect(html).toMatch(/aria-selected="true" class="lp-on">채보</);
    expect(html.match(/class="lp-step lp-on"/g)).toHaveLength(3);
    expect(html).toContain('lp-fill-line lp-neon');
    expect(html).not.toContain('lp-wipe');
    expect(html).not.toContain('lp-progress');
    // 카드는 MODE_CARD_FINAL 위치로 고정
    expect(html).toContain('translateY(-24px)');
  });
});
