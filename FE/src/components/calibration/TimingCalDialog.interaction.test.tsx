// @vitest-environment happy-dom
// 박자 맞추기 대화상자 [적용]: 값을 저장하고 onClose 전에 onApplied를 부른다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimingCalSnapshot } from '@/runtime/timingCalSession';
import { useSettings } from '@/store/settingsStore';
import { TimingCalDialog } from './TimingCalDialog';

const session = vi.hoisted(() => ({ snap: null as unknown }));
vi.mock('@/runtime/timingCalSession', () => ({
  timingCalSession: {
    subscribe: () => () => {},
    snapshot: () => session.snap,
    start: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));

const idle: TimingCalSnapshot = { phase: 'idle', beat: 0, withKick: false, totalBeats: 16, taps: 0, outcome: null, outputLatencyMs: null };
const done: TimingCalSnapshot = {
  ...idle,
  phase: 'result',
  beat: 16,
  outcome: { stick: { status: 'ok', pairs: 12, medianMs: -66, madMs: 8, offsetMs: -65, input: 'sensor' }, kick: null, recheck: false },
};

beforeEach(() => {
  useSettings.setState({ audioOffsetMs: 0, timingCal: null, timingCalPrompt: 'none' });
});
afterEach(cleanup);

describe('TimingCalDialog', () => {
  it('intro이면 안내에 한 줄이 더해지고 [나중에 하기]가 onClose를 부른다', () => {
    session.snap = idle;
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(<TimingCalDialog intro onClose={onClose} onApplied={onApplied} />);
    expect(screen.getByText('처음 한 번만 박자를 맞추면 판정이 정확해져요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '나중에 하기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('[적용]은 값을 저장하고 onClose 전에 onApplied를 부른다', () => {
    session.snap = done;
    const order: string[] = [];
    render(<TimingCalDialog onApplied={() => order.push('applied')} onClose={() => order.push('close')} />);
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(order).toEqual(['applied', 'close']);
    expect(useSettings.getState().audioOffsetMs).toBe(-65);
    expect(useSettings.getState().timingCal).not.toBeNull();
  });

  it('[취소]는 onApplied 없이 닫기만 한다', () => {
    session.snap = done;
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(<TimingCalDialog onApplied={onApplied} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplied).not.toHaveBeenCalled();
    expect(useSettings.getState().timingCal).toBeNull();
  });
});
