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

  it('큰 모양(lg)은 코칭 문구에만 붙고 스크린리더가 읽는다(role=status)', () => {
    const coach = renderToStaticMarkup(<GuideSlot mode="coach-info" title="스틱을 낮게" sub="높이는 주먹 하나만큼" size="lg" />);
    expect(coach).toContain('class="guide-slot coach-info lg"');
    expect(coach).toContain('role="status"');
    // 기본 안내는 lg를 줘도 작은 칸 그대로다
    const guide = renderToStaticMarkup(<GuideSlot mode="guide" title="악보 연습" size="lg" />);
    expect(guide).toContain('class="guide-slot"');
    expect(guide).not.toContain('role="status"');
    // 크기를 안 주면 지금 크기(리듬 게임)
    expect(renderToStaticMarkup(<GuideSlot mode="coach-good" title="그거예요!" />)).toContain('class="guide-slot coach-good"');
  });
});
