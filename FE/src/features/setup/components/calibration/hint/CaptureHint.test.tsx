// @vitest-environment happy-dom
// 실수 안내 그림과 보정 본문 연결 검증(PLAY-004 v0.4 D15~D20): 평소 없음, ① 같은 지점, ② 멀어질 방향(글자·그림), ③ 방향 그림(6초·수락 시 사라짐·반대편 모서리), 첫 안내 중에는 없음.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({ redo: vi.fn(), next: vi.fn(), cancelCapture: vi.fn(), skipRealign: vi.fn() }));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: h }));

import { CalibrationStage } from '../CalibrationStage';
import { NOTICE_MIN_MS } from '../useCaptureNotice';
import { AimGuide } from './AimGuide';
import { CaptureHint } from './CaptureHint';
import { STUCK_HINT_MS } from './hintPick';
import { IDLE_CALIBRATION, useLive } from '@/store/liveStore';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';

function setCapture(over: Partial<CaptureSnapshot> = {}): void {
  const cap: CaptureSnapshot = {
    phase: 'capturing',
    hands: [0, 1],
    targetHands: [0, 1],
    wrongHand: null,
    order: [...CAPTURE_ORDER],
    index: 1,
    target: 'CRASH',
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

/** 스틱을 조금 움직인다(0.5초마다 재는 자세 변화가 3° 이상이 되게) */
function wiggle(step: number): void {
  useLive.setState({ pose: [{ pitch: 0, yaw: step * 10 }, { pitch: 0, yaw: 0 }] });
}

/** 0.5초씩 n번, 그때마다 스틱을 움직이며 보낸다 */
function moveFor(ms: number): void {
  for (let t = 0, i = 1; t < ms; t += 500, i += 1) {
    act(() => {
      wiggle(i);
      vi.advanceTimersByTime(500);
    });
  }
}

const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useLive.setState({ calibration: IDLE_CALIBRATION });
});

describe('CaptureHint 그림', () => {
  it('안내가 없거나 방향 그림 차례면 아무것도 그리지 않는다', () => {
    expect(render(<CaptureHint hint={null} skin="acoustic" />).container.innerHTML).toBe('');
    expect(render(<CaptureHint hint={{ kind: 'aim', pad: 'RIDE', stickId: 1 }} skin="acoustic" />).container.innerHTML).toBe('');
  });

  it('① 같은 지점: 알갱이 둘·합쳐진 점·물결 둘과 「동일한 지점」 글자', () => {
    const { container } = render(<CaptureHint hint={{ kind: 'same', pad: 'SNARE' }} skin="acoustic" />);
    expect(q(container, 'cal-hint')?.dataset.kind).toBe('same');
    expect(container.querySelectorAll('.cal-hint-orb').length).toBe(2);
    expect(container.querySelectorAll('.cal-hint-core').length).toBe(1);
    expect(container.querySelectorAll('.cal-hint-ripple').length).toBe(2);
    expect(container.querySelector('.cal-hint-label')?.textContent).toBe('동일한 지점');
    expect(container.querySelector('.cal-hint-label')?.classList.contains('below')).toBe(false);
  });

  it('② 멀어질 방향: 이웃 빛·밀려나는 윤곽·화살촉과 「하이햇에서 더 멀리」. 윤곽이 위로 가므로 글자는 패드 아래', () => {
    const { container } = render(<CaptureHint hint={{ kind: 'away', pad: 'CRASH', near: 'HIHAT' }} skin="acoustic" />);
    expect(q(container, 'cal-hint')?.dataset.kind).toBe('away');
    expect(container.querySelector('.cal-hint-halo')).not.toBeNull();
    expect(container.querySelector('.cal-hint-nudge .cal-hint-ring')).not.toBeNull();
    expect(container.querySelector('.cal-hint-nudge .cal-hint-head')).not.toBeNull();
    const nudge = container.querySelector<SVGGElement>('.cal-hint-nudge');
    expect(parseFloat(nudge?.style.getPropertyValue('--dy') ?? '0')).toBeLessThan(0);
    expect(container.querySelector('.cal-hint-label')?.textContent).toBe('하이햇에서 더 멀리');
    expect(container.querySelector('.cal-hint-label')?.classList.contains('below')).toBe(true);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('AimGuide 방향 그림', () => {
  it('위·옆 두 그림과 손 색 표시가 있고 각도 숫자는 없다', () => {
    const { container } = render(<AimGuide pad="RIDE" stickId={1} side="left" />);
    const el = q(container, 'cal-aim');
    expect(el?.dataset.hand).toBe('1');
    expect(el?.dataset.side).toBe('left');
    expect(el?.getAttribute('aria-label')).toBe('오른손 라이드 방향 안내');
    expect([...container.querySelectorAll('figcaption')].map((f) => f.textContent)).toEqual(['위에서 본 모습', '옆에서 본 모습']);
    expect(container.querySelectorAll('.cal-aim-stick').length).toBe(2);
    expect(el?.textContent).not.toMatch(/\d/);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('CalibrationStage 실수 안내 연결', () => {
  it('실수가 없으면 드럼 그림 위에 안내가 없다', () => {
    setCapture();
    const { container } = render(<CalibrationStage />);
    expect(q(container, 'cal-hint')).toBeNull();
    expect(q(container, 'cal-aim')).toBeNull();
  });

  it('① 퍼짐 경고가 2번 연속이면 뜨고, 그 손이 채워 0이 되면 사라진다', () => {
    setCapture({ target: 'SNARE', index: 2, spreadStreak: [2, 0] });
    const { container } = render(<CalibrationStage />);
    expect(q(container, 'cal-hint')?.dataset.kind).toBe('same');
    expect(q(container, 'cal-hint')?.closest('.drum-kit-fx')).not.toBeNull();
    act(() => setCapture({ target: 'SNARE', index: 2, spreadStreak: [0, 0], counts: [2, 0] }));
    expect(q(container, 'cal-hint')).toBeNull();
  });

  it('② 다시 치는 패드에 간격 기록이 있으면 뜨고, 패드가 넘어가면 사라진다', () => {
    setCapture({ gapHints: [{ stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 10 }] });
    const { container } = render(<CalibrationStage />);
    expect(q(container, 'cal-hint')?.dataset.kind).toBe('away');
    expect(container.querySelector('.cal-hint-label')?.textContent).toBe('하이햇에서 더 멀리');
    act(() => setCapture({ target: 'SNARE', index: 2 }));
    expect(q(container, 'cal-hint')).toBeNull();
  });

  it('③ 스틱이 움직이는데 6초 넘게 수락이 없으면 반대편 모서리에 방향 그림이 뜨고, 타격이 수락되면 사라진다', () => {
    setCapture({ target: 'RIDE', index: 6, targetHands: [1] });
    const { container } = render(<CalibrationStage />);
    moveFor(STUCK_HINT_MS);
    expect(q(container, 'cal-aim')).toBeNull();
    moveFor(1000);
    const aim = q(container, 'cal-aim');
    expect(aim?.dataset.hand).toBe('1');
    // 라이드는 그림 오른쪽에 있으므로 카드는 왼쪽
    expect(aim?.dataset.side).toBe('left');
    expect(aim?.closest('.cal-stage-canvas')).not.toBeNull();
    // 스틱이 잠깐 멈춰도 깜빡이지 않는다
    act(() => void vi.advanceTimersByTime(1500));
    expect(q(container, 'cal-aim')).not.toBeNull();
    act(() => setCapture({ target: 'RIDE', index: 6, targetHands: [1], counts: [0, 1], lastAccepted: { stickId: 1, pad: 'RIDE', at: performance.now() } }));
    moveFor(500);
    expect(q(container, 'cal-aim')).toBeNull();
  });

  it('③ 스틱이 가만히 있으면 6초가 지나도 뜨지 않는다', () => {
    setCapture();
    const { container } = render(<CalibrationStage />);
    act(() => void vi.advanceTimersByTime(STUCK_HINT_MS + 3000));
    expect(q(container, 'cal-aim')).toBeNull();
  });

  it('첫 안내가 떠 있는 동안에는 뜨지 않고, 첫 안내가 닫히면 뜬다', () => {
    setCapture({ target: 'SNARE', index: 2, spreadStreak: [0, 0] });
    const { container } = render(<CalibrationStage notice />);
    act(() => setCapture({ target: 'SNARE', index: 2, spreadStreak: [2, 0], lastAccepted: { stickId: 0, pad: 'SNARE', at: 1 } }));
    expect(q(container, 'cal-notice')?.dataset.open).toBe('true');
    expect(q(container, 'cal-hint')).toBeNull();
    act(() => void vi.advanceTimersByTime(NOTICE_MIN_MS));
    expect(q(container, 'cal-notice')?.dataset.open).toBe('false');
    expect(q(container, 'cal-hint')?.dataset.kind).toBe('same');
  });

  it('결과 화면에서는 뜨지 않는다', () => {
    setCapture({ phase: 'done', target: null, targetHands: [], spreadStreak: [2, 2] });
    const { container } = render(<CalibrationStage />);
    expect(q(container, 'cal-hint')).toBeNull();
  });
});
