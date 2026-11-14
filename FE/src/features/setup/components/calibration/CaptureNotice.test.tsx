// @vitest-environment happy-dom
// 보정 팝업 첫 안내(CaptureNotice) 검증: 두 줄 문구와 강조할 말, 첫 수락 타격 + 최소 표시 시간 뒤에만 사라짐, 한 번 사라지면 다시 뜨지 않음, 팝업에서만 뜸.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({ redo: vi.fn(), next: vi.fn(), cancelCapture: vi.fn(), skipRealign: vi.fn() }));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: h }));

import { CalibrationDialog } from './CalibrationDialog';
import { CalibrationStage } from './CalibrationStage';
import { CaptureNotice } from './CaptureNotice';
import { NOTICE_MIN_MS, useCaptureNotice } from './useCaptureNotice';
import { IDLE_CALIBRATION, useLive } from '@/store/liveStore';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';

/** 막 시작한 보정(받은 타격 없음)에 over를 덮어 스냅샷을 넣는다 */
function setCapture(over: Partial<CaptureSnapshot> = {}): void {
  const cap: CaptureSnapshot = {
    phase: 'capturing',
    hands: [0, 1],
    targetHands: [0, 1],
    wrongHand: null,
    order: [...CAPTURE_ORDER],
    index: 0,
    target: 'HIHAT',
    counts: [0, 0],
    captured: {},
    warning: null,
    gapWarnings: [],
    advancing: false,
    lastAccepted: null,
    radiusOverrides: {},
    base: [null, null],
    spreadStreak: [0, 0],
    gapHints: [],
    ...over,
  };
  useLive.setState({ calibration: { mode: 'capture', capture: cap, realign: null, hands: cap.hands, target: 'new' } });
}

/** 팝업에서처럼 훅이 정한 열림 상태로 그린다 */
function Notice() {
  return <CaptureNotice open={useCaptureNotice(true)} />;
}

const notice = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="cal-notice"]');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useLive.setState({ calibration: IDLE_CALIBRATION });
});

describe('CaptureNotice 첫 안내', () => {
  it('두 줄 문구를 보이고 강조할 말만 em으로 감싼다', () => {
    setCapture();
    const { container } = render(<Notice />);
    const el = notice(container);
    expect(el?.dataset.open).toBe('true');
    expect(el?.querySelector('.cal-notice-main')?.textContent).toBe('양 스틱 모두 동일한 지점을 타격해 주세요.');
    expect(el?.querySelector('.cal-notice-sub')?.textContent).toBe('타격 시 스틱과 손목의 각도가 패드 형성에 반영됩니다.');
    expect([...(el?.querySelectorAll('em') ?? [])].map((e) => e.textContent)).toEqual(['동일한 지점', '스틱과 손목의 각도']);
  });

  it('타격이 없으면 시간이 지나도 남고, 타격이 수락돼도 최소 표시 시간 전에는 남는다', () => {
    setCapture();
    const { container } = render(<Notice />);
    act(() => void vi.advanceTimersByTime(NOTICE_MIN_MS * 3));
    expect(notice(container)?.dataset.open).toBe('true');

    cleanup();
    setCapture();
    const second = render(<Notice />);
    act(() => setCapture({ counts: [1, 0], lastAccepted: { stickId: 0, pad: 'HIHAT', at: 1 } }));
    act(() => void vi.advanceTimersByTime(NOTICE_MIN_MS - 1));
    expect(notice(second.container)?.dataset.open).toBe('true');
    act(() => void vi.advanceTimersByTime(1));
    expect(notice(second.container)?.dataset.open).toBe('false');
    expect(notice(second.container)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('한 번 사라지면 [다시]로 받은 타격이 비워져도 다시 뜨지 않는다', () => {
    setCapture();
    const { container } = render(<Notice />);
    act(() => void vi.advanceTimersByTime(NOTICE_MIN_MS));
    act(() => setCapture({ counts: [1, 0] }));
    expect(notice(container)?.dataset.open).toBe('false');
    act(() => setCapture());
    expect(notice(container)?.dataset.open).toBe('false');
  });

  it('보정 팝업에서만 뜬다: CalibrationDialog에는 있고 notice 없이 쓴 CalibrationStage에는 없다', () => {
    setCapture();
    const stage = render(<CalibrationStage />);
    expect(notice(stage.container)).toBeNull();
    cleanup();
    setCapture();
    render(<CalibrationDialog presetName="내 배치" onSave={() => {}} />);
    expect(notice(document.body)?.closest('.cal-stage-canvas')).not.toBeNull();
  });
});
