// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

// LazyMotion 공급자 없이 그린다 — 기능 청크가 오기 전에도 표시가 제자리에 있어야 한다(설계 D6)
function view(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
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
