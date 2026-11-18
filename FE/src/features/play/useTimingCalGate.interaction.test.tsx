// @vitest-environment happy-dom
// 첫 연주 전 박자 맞추기 관문 훅: 조건에 걸리면 막고 대화상자를 열고, 닫으면 [적용]이면 done·아니면 skipped로 저장한다.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { useTimingCalGate } from './useTimingCalGate';

// 대화상자는 가짜로 바꾼다: intro 여부와 [적용]·[닫기]만 흉내
vi.mock('@/components/calibration/TimingCalDialog', () => ({
  TimingCalDialog: ({ intro, onApplied, onClose }: { intro?: boolean; onApplied?: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="가짜 박자 맞추기" data-intro={String(intro)}>
      <button
        onClick={() => {
          onApplied?.();
          onClose();
        }}
      >
        적용
      </button>
      <button onClick={onClose}>닫기</button>
    </div>
  ),
}));

const rec = { measuredAt: 1, medianMs: -60, madMs: 8, pairs: 12, input: 'sensor' as const, outputLatencyMs: null, kick: null };

beforeEach(() => {
  useSettings.setState({ timingCal: null, timingCalPrompt: 'none' });
});
afterEach(cleanup);

/** 훅을 렌더하는 작은 화면. 관문 함수는 밖으로 꺼내 쓴다 */
function mount(isSensor = true, onClosed?: () => void) {
  const out: { gate: () => boolean; open: boolean } = { gate: () => false, open: false };
  function Host() {
    const g = useTimingCalGate({ isSensor: () => isSensor, onClosed });
    useLayoutEffect(() => {
      out.gate = g.gate;
      out.open = g.open;
    });
    return <>{g.dialog}</>;
  }
  render(<Host />);
  return out;
}

describe('useTimingCalGate', () => {
  it('조건에 걸리면 true를 돌려 시작을 막고 intro 대화상자를 연다', () => {
    const g = mount();
    let blocked = false;
    act(() => {
      blocked = g.gate();
    });
    expect(blocked).toBe(true);
    expect(g.open).toBe(true);
    expect(screen.getByRole('dialog').getAttribute('data-intro')).toBe('true');
  });

  it('열려 있는 동안 다시 불려도 계속 막는다(자동 시작이 겹쳐도 대화상자는 하나)', () => {
    const g = mount();
    act(() => void g.gate());
    let again = false;
    act(() => {
      again = g.gate();
    });
    expect(again).toBe(true);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('[적용]으로 닫히면 done, onClosed도 부른다', () => {
    const onClosed = vi.fn();
    const g = mount(true, onClosed);
    act(() => void g.gate());
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(useSettings.getState().timingCalPrompt).toBe('done');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(g.open).toBe(false);
  });

  it('적용 없이 닫히면 skipped이고, 그다음 호출은 막지 않는다', () => {
    const g = mount();
    act(() => void g.gate());
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
    let blocked = true;
    act(() => {
      blocked = g.gate();
    });
    expect(blocked).toBe(false);
  });

  it.each([
    ['키보드 입력', false, { timingCalPrompt: 'none' as const }],
    ['측정 기록 있음', true, { timingCal: rec }],
    ['skipped', true, { timingCalPrompt: 'skipped' as const }],
    ['done', true, { timingCalPrompt: 'done' as const }],
  ])('%s이면 막지 않고 상태도 바꾸지 않는다', (_n, sensor, over) => {
    useSettings.setState(over);
    const before = useSettings.getState().timingCalPrompt;
    const g = mount(sensor);
    let blocked = true;
    act(() => {
      blocked = g.gate();
    });
    expect(blocked).toBe(false);
    expect(g.open).toBe(false);
    expect(useSettings.getState().timingCalPrompt).toBe(before);
  });
});
