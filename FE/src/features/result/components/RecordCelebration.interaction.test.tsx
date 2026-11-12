// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFETTI_END_MS } from '@/features/result/domain/confetti';
import { RECORD_TEXT_MS, RecordCelebration } from './RecordCelebration';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RecordCelebration', () => {
  it('body에 창 전체 층을 올리고 네온 글자와 상세 한 줄을 보인다(스크린리더에는 숨김)', () => {
    const { container } = render(<RecordCelebration detail="이전 1,200 → 현재 1,310" />);
    expect(container.querySelector('.record-celebrate')).toBeNull();
    const layer = document.body.querySelector('.record-celebrate')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelector('canvas')).not.toBeNull();
    expect(layer.textContent).toContain('NEW BEST');
    expect(layer.textContent).toContain('최고 기록 갱신');
    // 카드 없이 글자만
    expect(layer.querySelector('.record-celebrate-card')).toBeNull();
    expect(layer.textContent).toContain('이전 1,200 → 현재 1,310');
  });

  it('detail이 없으면 상세 줄을 그리지 않는다', () => {
    render(<RecordCelebration />);
    expect(document.body.querySelector('.record-celebrate-detail')).toBeNull();
  });

  it('색종이와 글이 모두 끝나면 층을 내리고 onDone을 부른다', () => {
    const onDone = vi.fn();
    render(<RecordCelebration onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(Math.max(CONFETTI_END_MS, RECORD_TEXT_MS) - 1));
    expect(document.body.querySelector('.record-celebrate')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(document.body.querySelector('.record-celebrate')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('끝나기 전에 화면을 떠나면 층도 함께 사라진다', () => {
    const { unmount } = render(<RecordCelebration />);
    unmount();
    expect(document.body.querySelector('.record-celebrate')).toBeNull();
  });
});
