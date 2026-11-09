import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingView } from './LandingView';

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
    expect(render(true)).toMatch(/^<div class="lp">/);
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

  it('채보 탭 기본은 채보, 소개 문장과 결과 지표가 보인다', () => {
    const html = render(true);
    expect(html).toMatch(/aria-selected="true" class="lp-on">채보</);
    expect(html).toContain('드럼을 칠 수 있다면.');
    expect(html).toContain('lp-stat lp-acc');
    expect(html).toContain('lp-stat lp-weak');
  });
});
