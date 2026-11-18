// @vitest-environment happy-dom
// 제목 흐름 (설계 CHART-003 라이브러리 재생바 D3~D5). 꺼짐이거나 칸에 들어가는 제목은 그대로, 켜짐이고 칸보다 긴 제목만 흐른다.
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarqueeTitle } from './MarqueeTitle';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 칸 236px, 제목 textPx, 묶음(제목 + 간격) textPx + 32px로 측정되게 한다 */
function mockWidths(textPx: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('studio-card-title') || this.classList.contains('studio-row-title')) return 236;
    if (this.classList.contains('marquee-item')) return textPx;
    if (this.classList.contains('marquee-group')) return textPx + 32;
    return 0;
  });
}

describe('MarqueeTitle', () => {
  it('꺼짐: 기존과 같은 말줄임 span 하나', () => {
    expect(renderToStaticMarkup(<MarqueeTitle className="studio-card-title" text="별빛 산책" active={false} />)).toBe(
      '<span class="studio-card-title" title="별빛 산책">별빛 산책</span>',
    );
  });

  it('켜짐이어도 칸에 들어가는 짧은 제목은 흐르지 않고 한 번만 보인다', () => {
    mockWidths(40);
    const { container } = render(<MarqueeTitle className="studio-card-title" text="가" active />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('studio-card-title');
    expect(root.querySelector('.marquee-track')).toBeNull();
    expect(root.textContent).toBe('가');
  });

  it('켜짐이고 칸보다 긴 제목: 묶음 두 개가 흐르고 둘째 묶음은 읽기 대상이 아니다', () => {
    mockWidths(400);
    const { container } = render(<MarqueeTitle className="studio-card-title" text="아주 긴 제목" active />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('studio-card-title marquee');
    expect(root.getAttribute('title')).toBe('아주 긴 제목');
    const groups = root.querySelectorAll('.marquee-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute('aria-hidden')).toBeNull();
    expect(groups[1].getAttribute('aria-hidden')).toBe('true');
    // 제목은 묶음마다 하나씩만(복제해서 늘어놓지 않는다)
    expect(root.querySelectorAll('.marquee-item')).toHaveLength(2);
    // 묶음 432px ÷ 초당 40px = 10.8초
    const track = root.querySelector('.marquee-track') as HTMLElement;
    expect(track.style.getPropertyValue('--marquee-dur')).toBe('10.8s');
  });

  it('측정값이 없으면(너비 0) 흐르지 않는다', () => {
    const { container } = render(<MarqueeTitle className="studio-card-title" text="별빛 산책" active />);
    expect(container.querySelector('.marquee')).toBeNull();
  });

  it('흐르다가 꺼지면 말줄임 span으로 돌아온다', () => {
    mockWidths(400);
    const { container, rerender } = render(<MarqueeTitle className="studio-row-title" text="아주 긴 제목" active />);
    expect(container.querySelector('.marquee')).toBeTruthy();
    rerender(<MarqueeTitle className="studio-row-title" text="아주 긴 제목" active={false} />);
    expect(container.innerHTML).toBe('<span class="studio-row-title" title="아주 긴 제목">아주 긴 제목</span>');
  });
});
