import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScreenGate } from './ScreenGate';

describe('ScreenGate', () => {
  it('open이 거짓이면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ScreenGate open={false} />)).toBe('');
  });
  it('open이면 alertdialog와 안내 문구를 그린다', () => {
    const html = renderToStaticMarkup(<ScreenGate open />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('가로 화면에서 연습할 수 있어요');
    expect(html).toContain('기기를 가로로 돌리거나 창을 넓혀 주세요');
    expect(html).not.toContain('<button');
  });
});
