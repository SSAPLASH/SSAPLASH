// DrumKit underlay·overlay 자리(자유 연습 무대, MODE-002 D5) 테스트(SSR 문자열)
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';

describe('DrumKit underlay·overlay', () => {
  it('둘 다 없으면 래퍼 없이 마크업이 그대로다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html).not.toContain('drum-kit-fx');
    expect(html.startsWith('<svg')).toBe(true);
  });

  it('underlay는 래퍼 안 첫 자식(SVG 앞), overlay는 마지막 자식', () => {
    const html = renderToStaticMarkup(<DrumKit underlay={<i className="under" />} overlay={<b className="over" />} />);
    expect(html.startsWith('<div class="drum-kit-fx"><i class="under"></i><svg')).toBe(true);
    expect(html.endsWith('</svg><b class="over"></b></div>')).toBe(true);
    // 이펙트가 꺼져 있으면 캔버스는 없다
    expect(html).not.toContain('fx-canvas');
  });

  it('하나만 줘도 래퍼로 감싼다', () => {
    expect(renderToStaticMarkup(<DrumKit overlay={<b />} />).startsWith('<div class="drum-kit-fx">')).toBe(true);
    expect(renderToStaticMarkup(<DrumKit underlay={<i />} />).startsWith('<div class="drum-kit-fx"><i></i><svg')).toBe(true);
  });

  it('이펙트와 함께면 overlay가 캔버스 뒤(위)에 온다', () => {
    const html = renderToStaticMarkup(<DrumKit effects underlay={<i className="under" />} overlay={<b className="over" />} />);
    const iSvg = html.indexOf('<svg');
    const iCanvas = html.indexOf('fx-canvas');
    const iOver = html.indexOf('class="over"');
    expect(html.indexOf('class="under"')).toBeLessThan(iSvg);
    expect(iSvg).toBeLessThan(iCanvas);
    expect(iCanvas).toBeLessThan(iOver);
  });
});
