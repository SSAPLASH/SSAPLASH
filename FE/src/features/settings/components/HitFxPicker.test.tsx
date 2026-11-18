// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LazyMotion, domMax } from 'motion/react';
import { useSettings } from '@/store/settingsStore';
import { HitFxPicker, nextFxTheme } from './HitFxPicker';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => useSettings.getState().setHitFxTheme('auto'));

function Connected() {
  const theme = useSettings((s) => s.hitFxTheme);
  const set = useSettings((s) => s.setHitFxTheme);
  return (
    <LazyMotion features={domMax} strict>
      <HitFxPicker value={theme} onChange={set} skin="acoustic" />
    </LazyMotion>
  );
}

describe('nextFxTheme', () => {
  it('순환한다', () => {
    expect(nextFxTheme('auto', 1)).toBe('electric');
    expect(nextFxTheme('auto', -1)).toBe('fire');
    expect(nextFxTheme('fire', 1)).toBe('auto');
  });
});

describe('HitFxPicker', () => {
  it('이름·설명·n / N을 보여 주고, 다음을 누르면 스토어에 저장된다', () => {
    render(<Connected />);
    expect(screen.getByText('기본')).toBeTruthy();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 타격 이펙트' }));
    expect(useSettings.getState().hitFxTheme).toBe('electric');
    expect(screen.getByText('전기')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이전 타격 이펙트' }));
    expect(useSettings.getState().hitFxTheme).toBe('auto');
  });

  it('좌우 화살표 키로도 넘긴다', () => {
    render(<Connected />);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowRight' });
    expect(useSettings.getState().hitFxTheme).toBe('electric');
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowLeft' });
    expect(useSettings.getState().hitFxTheme).toBe('auto');
  });

  it('미리보기 킷은 이펙트 캔버스를 가지며 데모가 도는 동안 이벤트를 낸다(타이머 진행)', () => {
    vi.useFakeTimers();
    const { container } = render(<Connected />);
    expect(container.querySelector('canvas.fx-canvas')).not.toBeNull();
    // 데모 타이머가 예외 없이 돈다
    expect(() => act(() => vi.advanceTimersByTime(3000))).not.toThrow();
  });
});
