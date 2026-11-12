import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuideSlot } from './GuideSlot';

describe('GuideSlot', () => {
  it('기본 모드는 `guide` 클래스를 붙이지 않는다(곡 선택 안내 줄 `.guide`의 2열 grid와 겹치지 않게)', () => {
    const html = renderToStaticMarkup(<GuideSlot mode="guide" title="노트에 맞춰 연주" sub="판정선에 노트가 닿을 때 타격하세요." />);
    expect(html).toContain('class="guide-slot"');
    expect(html).not.toContain('실시간 코칭');
  });

  it('코칭 모드는 모드 클래스와 라벨을 붙인다', () => {
    const html = renderToStaticMarkup(<GuideSlot mode="coach-warn" title="조금 빨라요" />);
    expect(html).toContain('class="guide-slot coach-warn"');
    expect(html).toContain('실시간 코칭');
  });
});
