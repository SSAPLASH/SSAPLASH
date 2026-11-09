import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HowtoPanel } from './HowtoPanel';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('HowtoPanel', () => {
  it('첫 방문 가로 4칸: 접수·드럼 분리·채보 생성·완료', () => {
    const html = renderToStaticMarkup(<HowtoPanel />);
    expect(count(html, 'class="studio-steps4-item"')).toBe(4);
    for (const t of ['접수', '드럼 분리', '채보 생성', '완료']) expect(html).toContain(`>${t}<`);
    expect(html).toContain('악보 연습·플레이가 열려요');
    expect(html).toContain('곡이 만들어지는 순서');
  });

  it('안내 패널(studio-howto)은 없다', () => {
    expect(renderToStaticMarkup(<HowtoPanel />)).not.toContain('studio-howto');
  });
});
