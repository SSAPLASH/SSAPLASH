// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { useSongs } from '@/store/songStore';
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

describe('Sidebar 악보 연습 하위 메뉴 (설계 MODE-003-악보-연습-하위-메뉴)', () => {
  const sub = () => screen.queryByRole('list', { name: '악보 연습 범위' });
  const items = () => [...(sub()?.querySelectorAll('a') ?? [])];
  const current = () => items().find((a) => a.getAttribute('aria-current') === 'page')?.textContent;

  /** 화면 폭을 가장한다. 테스트 환경의 기본 폭(1024)은 태블릿(강제 접힘)으로 잡힌다 */
  const viewport = (tablet: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: tablet && query === '(max-width: 1024px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

  beforeEach(() => {
    viewport(false);
    useAuth.setState({ status: 'authenticated', user: { id: 1, role: 'USER' } as UserMe });
    useSongs.setState({ source: 'api' });
    useSettings.setState({ sidebarCollapsed: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('악보 연습에 들어와 있으면 「악보 연습」 바로 아래에 네 범위가 이 순서·이 주소로 보인다', () => {
    const { container } = view('/sheet');
    expect(items().map((a) => a.textContent)).toEqual(['기본 곡', '내 곡', 'AI 추천곡', '학습 코스']);
    expect(items().map((a) => a.getAttribute('href'))).toEqual(['/sheet', '/sheet?scope=MINE', '/sheet?tab=recommend', '/sheet?tab=lessons']);
    // 부모 항목 바로 다음 자리
    const parent = container.querySelector('.side-item[aria-label="악보 연습"]');
    expect(parent?.nextElementSibling).toBe(sub());
  });

  it('지금 범위에 aria-current가 있다', () => {
    view('/sheet');
    expect(current()).toBe('기본 곡');
    cleanup();
    view('/sheet?scope=MINE&song=3');
    expect(current()).toBe('내 곡');
    cleanup();
    view('/sheet?tab=recommend');
    expect(current()).toBe('AI 추천곡');
    cleanup();
    view('/sheet?tab=lessons&song=9&chart=91');
    expect(current()).toBe('학습 코스');
  });

  it('알아보기 레슨 화면에서도 하위 메뉴가 보이고 학습 코스가 표시된다', () => {
    view('/sheet/lesson/12');
    expect(items()).toHaveLength(4);
    expect(current()).toBe('학습 코스');
  });

  it('하위 항목을 누르면 그 범위로 가고 표시가 옮겨 간다', () => {
    view('/sheet');
    fireEvent.click(screen.getByRole('link', { name: '학습 코스' }));
    expect(current()).toBe('학습 코스');
    fireEvent.click(screen.getByRole('link', { name: '내 곡' }));
    expect(current()).toBe('내 곡');
    // 부모 「악보 연습」을 누르면 기본 곡으로 돌아간다
    fireEvent.click(screen.getByRole('link', { name: '악보 연습' }));
    expect(current()).toBe('기본 곡');
  });

  it('하위 메뉴가 떠도 현재 위치 표시는 부모 「악보 연습」에 하나만 있다', () => {
    const { container } = view('/sheet?tab=lessons');
    expect(container.querySelectorAll('.side-active-mark')).toHaveLength(1);
    expect(container.querySelector('.side-item.active')?.getAttribute('aria-label')).toBe('악보 연습');
  });

  it('다른 화면에서는 하위 메뉴가 없다', () => {
    for (const path of ['/play', '/history', '/studio', '/studio/sheets/3']) {
      view(path);
      expect(sub()).toBeNull();
      cleanup();
    }
  });

  it('로그인하지 않았으면 기본 곡·내 곡만 보이고, 사라진 범위의 주소는 기본 곡으로 표시한다', () => {
    useAuth.setState({ status: 'anonymous', user: null });
    view('/sheet?tab=lessons');
    expect(items().map((a) => a.textContent)).toEqual(['기본 곡', '내 곡']);
    expect(current()).toBe('기본 곡');
  });

  it('사이드바가 접혀 있으면 하위 메뉴가 없다(화면 위 탭이 대신한다)', () => {
    useSettings.setState({ sidebarCollapsed: true });
    view('/sheet');
    expect(sub()).toBeNull();
  });

  it('태블릿 폭(1024px 이하)이면 설정과 상관없이 하위 메뉴가 없다', () => {
    viewport(true);
    view('/sheet');
    expect(sub()).toBeNull();
  });

  it('내장 곡 출처(개발용)면 하위 메뉴가 없다', () => {
    useSongs.setState({ source: 'builtin' });
    view('/sheet');
    expect(sub()).toBeNull();
  });
});
