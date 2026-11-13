// @vitest-environment happy-dom
// 레슨 통과 뒤 자동 넘김 카운트다운(설계 SETUP-학습-코스-자동-넘김 3-2·4-4): 3 → 2 → 1 → 이동 한 번, 조작하면 멈춤, 떠나면 타이머 없음
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoAdvance } from './useAutoAdvance';

function Probe({ enabled = true, onGo }: { enabled?: boolean; onGo: () => void }) {
  const auto = useAutoAdvance({ enabled, onGo });
  return (
    <div>
      <span data-testid="left">{auto.remaining === null ? 'none' : String(auto.remaining)}</span>
      <button data-auto-go onClick={auto.goNow}>지금 가기</button>
      <button onClick={auto.stop}>머무르기</button>
      <p>본문</p>
    </div>
  );
}
const left = () => screen.getByTestId('left').textContent;
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useAutoAdvance', () => {
  it('3 → 2 → 1로 줄고 3초가 되면 한 번만 이동한다', () => {
    const go = vi.fn();
    render(<Probe onGo={go} />);
    expect(left()).toBe('3');
    pass(1000);
    expect(left()).toBe('2');
    pass(1000);
    expect(left()).toBe('1');
    expect(go).not.toHaveBeenCalled();
    pass(1000);
    expect(go).toHaveBeenCalledTimes(1);
    pass(5000);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('꺼져 있으면 세지 않는다', () => {
    const go = vi.fn();
    render(<Probe enabled={false} onGo={go} />);
    expect(left()).toBe('none');
    pass(5000);
    expect(go).not.toHaveBeenCalled();
  });

  it.each([
    ['화면 누르기', () => fireEvent.pointerDown(screen.getByText('본문'))],
    ['스크롤', () => fireEvent.wheel(document)],
    ['키 누르기', () => fireEvent.keyDown(document, { key: 'a' })],
    ['터치', () => fireEvent.touchStart(document)],
    ['머무르기', () => fireEvent.click(screen.getByRole('button', { name: '머무르기' }))],
  ])('%s면 멈추고 이동하지 않는다', (_name, interact) => {
    const go = vi.fn();
    render(<Probe onGo={go} />);
    pass(1000);
    interact();
    expect(left()).toBe('none');
    pass(5000);
    expect(go).not.toHaveBeenCalled();
  });

  it('[지금 가기]는 누르는 순간 이동하고(누르기가 멈춤으로 처리되지 않는다) 그 뒤 0이 돼도 다시 이동하지 않는다', () => {
    const go = vi.fn();
    render(<Probe onGo={go} />);
    const button = screen.getByRole('button', { name: '지금 가기' });
    fireEvent.pointerDown(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(left()).not.toBe('none');
    fireEvent.click(button);
    expect(go).toHaveBeenCalledTimes(1);
    pass(5000);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('누르고 있어 반복되는 키는 멈춤으로 보지 않는다(레슨을 끝낸 키가 눌린 채일 수 있다)', () => {
    const go = vi.fn();
    render(<Probe onGo={go} />);
    fireEvent.keyDown(document, { key: 'a', repeat: true });
    expect(left()).toBe('3');
  });

  it('화면을 떠나면 타이머가 남지 않는다', () => {
    const go = vi.fn();
    const { unmount } = render(<Probe onGo={go} />);
    pass(1000);
    unmount();
    pass(5000);
    expect(go).not.toHaveBeenCalled();
  });
});
