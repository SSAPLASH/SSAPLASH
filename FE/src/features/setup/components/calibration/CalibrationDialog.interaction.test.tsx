// @vitest-environment happy-dom
// 보정 팝업(CalibrationDialog) 상호작용(SETUP-fixed-kit-noir D5·D11, U6): 라벨·[그만하기]·Esc는 cancelCapture, 바깥 누르기는 닫지 않는다. 결과 화면의 겹침 문구·[◯◯ 다시]·[저장].
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ redo: vi.fn(), next: vi.fn(), cancelCapture: vi.fn(), skipRealign: vi.fn() }));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: h }));

import { CalibrationDialog } from './CalibrationDialog';
import { IDLE_CALIBRATION, useLive, type CalibrationSnapshot } from '@/store/liveStore';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';
import type { PadId } from '@/domain/kit/pads';

const anchor = (pad: PadId, pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 0, samples: 2, spread: 1 });
const both = (pad: PadId, pitch: number, yaw: number): [ReturnType<typeof anchor>, ReturnType<typeof anchor>] => [anchor(pad, pitch, yaw), anchor(pad, pitch, yaw)];

/** 스네어(0°)와 스몰탐(14° 떨어짐)만 20° 미만, 나머지는 멀다 */
const ALL = {
  HIHAT: both('HIHAT', 0, -60),
  CRASH: both('CRASH', 30, -30),
  SNARE: both('SNARE', -20, 0),
  SMALL_TOM: both('SMALL_TOM', -20, 14),
  MID_TOM: both('MID_TOM', 10, 50),
  FLOOR_TOM: both('FLOOR_TOM', -30, 90),
  RIDE: both('RIDE', 40, 80),
};

function setCapture(over: Partial<CaptureSnapshot> = {}, target: CalibrationSnapshot['target'] = 'new'): void {
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
  useLive.setState({ calibration: { mode: 'capture', capture: cap, realign: null, hands: cap.hands, target } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  useLive.setState({ calibration: IDLE_CALIBRATION });
});

describe('CalibrationDialog 껍데기', () => {
  it('새 프리셋 보정이면 「새 프리셋 보정 · 드럼 위치」, 적용 프리셋이면 「{이름} 다시 보정 · 드럼 위치」 라벨', () => {
    setCapture({}, 'new');
    render(<CalibrationDialog presetName="내 배치" onSave={() => {}} />);
    expect(screen.getByRole('dialog', { name: '새 프리셋 보정 · 드럼 위치' })).toBeTruthy();
    cleanup();
    setCapture({}, 'active');
    render(<CalibrationDialog presetName="내 배치" onSave={() => {}} />);
    expect(screen.getByRole('dialog', { name: '내 배치 다시 보정 · 드럼 위치' })).toBeTruthy();
  });

  it('큰 안내(패드 이름 강조)·진행 점·타격 점이 팝업 안에 보인다', () => {
    setCapture();
    const { container } = render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('하이햇을 양손으로 2번씩 타격하세요');
    expect(container.querySelector('.cal-stage-pad')?.textContent).toBe('하이햇');
    expect(container.querySelectorAll('.cal-stage-dot')).toHaveLength(7);
    expect(container.querySelector('.cal-stage-dot.now')).not.toBeNull();
    expect(container.querySelector('[aria-label="왼손 0/2"]')).not.toBeNull();
  });

  it('[그만하기]를 누르면 cancelCapture', () => {
    setCapture();
    render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(h.cancelCapture).toHaveBeenCalledTimes(1);
  });

  it('Esc를 누르면 cancelCapture', () => {
    setCapture();
    render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(h.cancelCapture).toHaveBeenCalledTimes(1);
  });

  it('바깥(배경)을 눌러도 닫지 않는다', () => {
    setCapture();
    const { container } = render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    fireEvent.mouseDown(container.querySelector('.dialog-backdrop')!);
    fireEvent.click(container.querySelector('.dialog-backdrop')!);
    expect(h.cancelCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('CalibrationDialog 결과 화면', () => {
  const done = (over: Partial<CaptureSnapshot> = {}): void =>
    setCapture({ phase: 'done', index: 6, target: null, targetHands: [], captured: ALL, ...over });

  it('「7곳 모두 잡았어요」 + 겹침 문구 + 겹친 패드마다 [◯◯ 다시] + [저장]', () => {
    done();
    const { container } = render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('7곳 모두 잡았어요');
    expect(container.querySelector('.cal-result-overlaps')?.textContent).toMatch(/^스네어와 스몰탐이 너무 가까워요\(\d+°\)$/);
    expect(screen.getByRole('button', { name: '스네어 다시' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '스몰탐 다시' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '하이햇 다시' })).toBeNull();
    expect([...container.querySelectorAll('[data-warn-pad]')].map((e) => e.getAttribute('data-warn-pad')).sort()).toEqual(['SMALL_TOM', 'SNARE']);
  });

  it('[스몰탐 다시]는 그 패드를 redo, [저장]은 onSave', () => {
    const onSave = vi.fn();
    done();
    render(<CalibrationDialog presetName="x" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '스몰탐 다시' }));
    expect(h.redo).toHaveBeenCalledWith('SMALL_TOM');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('겹침이 없으면 문구·[다시] 버튼 없이 [저장]만', () => {
    done({ captured: { ...ALL, SMALL_TOM: both('SMALL_TOM', 40, 140) } });
    const { container } = render(<CalibrationDialog presetName="x" onSave={() => {}} />);
    expect(container.querySelector('.cal-overlap-line')).toBeNull();
    expect(screen.queryByRole('button', { name: /다시$/ })).toBeNull();
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });
});
