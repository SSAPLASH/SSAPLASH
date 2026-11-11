import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionDots } from './ConnectionDots';

function dots(html: string): string[] {
  return [...html.matchAll(/stick-conn-dot (on|off)">([LR])</g)].map((m) => `${m[2]}:${m[1]}`);
}

describe('ConnectionDots', () => {
  it('양손 연결', () => {
    const html = renderToStaticMarkup(<ConnectionDots left right />);
    expect(dots(html)).toEqual(['L:on', 'R:on']);
    expect(html).toContain('왼손 스틱 연결됨, 오른손 스틱 연결됨');
  });

  it('한 손만 연결', () => {
    const html = renderToStaticMarkup(<ConnectionDots left right={false} />);
    expect(dots(html)).toEqual(['L:on', 'R:off']);
    expect(html).toContain('오른손 스틱 연결 안 됨');
  });

  it('둘 다 끊김, className 전달', () => {
    const html = renderToStaticMarkup(<ConnectionDots left={false} right={false} className="x" />);
    expect(dots(html)).toEqual(['L:off', 'R:off']);
    expect(html).toContain('stick-conn-dots x');
    expect(html).toContain('role="img"');
  });
});
