// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

// LazyMotion 공급자 없이 그린다 — 기능 청크가 오기 전에도 표시가 제자리에 있어야 한다(설계 D6)
function view(path: string, onPrefetch?: (to: string) => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar onPrefetch={onPrefetch} />
    </MemoryRouter>,
  );
}

describe('Sidebar 현재 위치 표시', () => {
  it('활성 항목 안에만 표시가 하나 있다', () => {
    const { container } = view('/play');
    const marks = container.querySelectorAll('.side-active-mark');
    expect(marks).toHaveLength(1);
    const active = container.querySelector('.side-item.active');
    expect(active?.getAttribute('aria-label')).toBe('리듬 게임');
    expect(active?.contains(marks[0])).toBe(true);
  });

  it('경로가 바뀌면 표시가 새 항목으로 옮겨 간다', () => {
    const { container } = view('/history');
    expect(container.querySelector('.side-item.active .side-active-mark')).not.toBeNull();
    expect(container.querySelector('.side-item.active')?.getAttribute('aria-label')).toBe('연주 기록');
  });

  it('메뉴에 없는 경로면 표시가 없다', () => {
    const { container } = view('/result/1');
    expect(container.querySelectorAll('.side-active-mark')).toHaveLength(0);
  });
});

describe('Sidebar 미리 받기 (설계 TECH-351)', () => {
  it('hover 100ms 뒤·포커스 즉시 그 메뉴 경로를 미리 받고, 100ms 전에 떠나면 받지 않는다', () => {
    const onPrefetch = vi.fn();
    vi.useFakeTimers();
    try {
      view('/free', onPrefetch);
      const studio = screen.getByRole('link', { name: '라이브러리' });
      fireEvent.mouseEnter(studio);
      vi.advanceTimersByTime(50);
      fireEvent.mouseLeave(studio);
      vi.advanceTimersByTime(200);
      expect(onPrefetch).not.toHaveBeenCalled();
      fireEvent.mouseEnter(studio);
      vi.advanceTimersByTime(100);
      expect(onPrefetch).toHaveBeenCalledWith('/studio');
      fireEvent.focus(screen.getByRole('link', { name: '연주 기록' }));
      expect(onPrefetch).toHaveBeenCalledWith('/history');
    } finally {
      vi.useRealTimers();
    }
  });
});
