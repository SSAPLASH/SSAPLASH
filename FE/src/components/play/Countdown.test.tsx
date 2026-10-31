import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Countdown } from './Countdown';

/** 태그를 걷어낸 텍스트 */
const text = (html: string) => html.replace(/<[^>]*>/g, '');

describe('Countdown', () => {
  it.each([3, 2, 1])('숫자 %i만 보인다', (n) => {
    const html = renderToStaticMarkup(<Countdown value={n} />);
    expect(text(html)).toBe(String(n));
    expect(html).toContain(`data-value="${n}"`);
  });

  it("'go'는 시작! 문구", () => {
    const html = renderToStaticMarkup(<Countdown value="go" />);
    expect(text(html)).toBe('시작!');
    expect(html).toContain('data-value="go"');
  });

  it('원·캡션 요소가 없다(U22)', () => {
    const html = renderToStaticMarkup(<Countdown value={3} />);
    expect(html).not.toMatch(/circle|ring|caption/i);
    expect(html.match(/<span/g)).toHaveLength(1);
  });

  it('aria-live 알림 영역', () => {
    const html = renderToStaticMarkup(<Countdown value={2} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="assertive"');
  });
});
