// DrumKit effects prop 기본값 테스트(SSR 문자열)
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';

describe('DrumKit effects', () => {
  it('기본은 이펙트 캔버스가 없고 마크업이 그대로다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html).not.toContain('fx-canvas');
    expect(html).not.toContain('drum-kit-fx');
  });
  it('effects를 켜면 SVG 위에 겹치는 캔버스가 있다', () => {
    const html = renderToStaticMarkup(<DrumKit effects />);
    expect(html).toContain('<canvas');
    expect(html).toContain('fx-canvas');
    expect(html).toContain('data-fx-theme="auto"');
  });
  it('fxTheme를 넘기면 설정값 대신 그 테마를 쓴다', () => {
    expect(renderToStaticMarkup(<DrumKit effects fxTheme="electric" />)).toContain('data-fx-theme="electric"');
  });
});
