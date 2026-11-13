// @vitest-environment happy-dom
// 드럼 세팅 고정 배치·보정 팝업(SETUP-fixed-kit-noir): 그림은 저장된 kitLayout과 무관하게 같다, 타격 확인에 손 열이 없다,
// [새로 보정]이 팝업을 열고 Esc·[그만하기]가 닫으며 바깥 누르기는 닫지 않는다, 마우스 클릭은 타격하지 않는다(data-no-pointer-strike).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  startCapture: vi.fn(),
  cancelCapture: vi.fn(),
  next: vi.fn(),
  finish: vi.fn(),
  redo: vi.fn(),
  skipRealign: vi.fn(),
  startRealign: vi.fn(),
  cancelRealign: vi.fn(),
}));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: h }));

import { useSettings } from '@/store/settingsStore';
import { IDLE_CALIBRATION, useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { SetupPage } from './SetupPage';

const initialSettings = useSettings.getState();
const initialLive = useLive.getState();
const initialPresets = usePresets.getState();

function renderSetup() {
  const router = createMemoryRouter([{ path: '/setup', element: <SetupPage /> }], { initialEntries: ['/setup'] });
  return render(<RouterProvider router={router} />);
}

const CAPTURING = {
  mode: 'capture',
  target: 'new',
  capture: {
    phase: 'capturing',
    hands: [0, 1],
    order: [...CAPTURE_ORDER],
    index: 0,
    target: 'SNARE',
    targetHands: [0, 1],
    wrongHand: null,
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
  },
  realign: null,
  hands: [0, 1],
};

beforeEach(() => {
  vi.clearAllMocks();
  // [새로 보정]이 실제 세션처럼 calibration.mode를 capture로 바꾼다
  h.startCapture.mockImplementation(() => useLive.setState({ calibration: CAPTURING } as never));
  h.cancelCapture.mockImplementation(() => useLive.setState({ calibration: IDLE_CALIBRATION }));
});
afterEach(() => {
  cleanup();
  useSettings.setState(initialSettings, true);
  useLive.setState(initialLive, true);
  usePresets.setState(initialPresets, true);
});

/** 드럼 그림 SVG의 마크업(패드 자리·크기가 그대로 드러난다). useId로 붙는 id 번호는 지운다 */
const kitMarkup = (container: HTMLElement) => (container.querySelector('.setup-kit-zone svg.drum-kit')?.innerHTML ?? '').replace(/kitr\d+/g, 'kit');

describe('드럼 세팅 고정 배치', () => {
  it('저장된 kitLayout이 달라도 드럼 그림은 같다(기본 배치 고정)', () => {
    useSettings.setState({ sensorKind: 'pointer', kitLayout: DEFAULT_KIT_LAYOUT });
    const a = renderSetup();
    const base = kitMarkup(a.container);
    expect(base.length).toBeGreaterThan(0);
    a.unmount();
    useSettings.setState({ kitLayout: { ...DEFAULT_KIT_LAYOUT, SNARE: { ...DEFAULT_KIT_LAYOUT.SNARE, x: 0.7, y: 0.3 } } });
    const b = renderSetup();
    expect(kitMarkup(b.container)).toBe(base);
  });

  it('센서 면은 마우스 클릭 타격을 막는다(data-no-pointer-strike)', () => {
    useSettings.setState({ sensorKind: 'pointer' });
    const { container } = renderSetup();
    const surface = container.querySelector('.setup-kit-surface')!;
    expect(surface.hasAttribute('data-no-pointer-strike')).toBe(true);
    expect(surface.hasAttribute('data-pointer-strike')).toBe(false);
  });

  it('타격 확인 머리에 손 열이 없다(패드·세기·시각)', () => {
    renderSetup();
    const head = document.querySelector('.setup-hitlog-row.head')!;
    expect([...head.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['패드', '세기', '시각']);
  });

  it('머리 줄: 제목 「내 드럼」, 보조 문구 「프리셋: … · 8패드」', () => {
    renderSetup();
    expect(screen.getByRole('heading', { name: '내 드럼' })).toBeTruthy();
    expect(document.querySelector('.setup-stage-title span')?.textContent).toBe('프리셋: 시스템 기본 · 8패드');
  });
});

describe('보정 팝업 열고 닫기', () => {
  beforeEach(() => {
    useSettings.setState({ sensorKind: 'pointer' });
    useLive.setState({ connected: [true, true] });
  });

  it('평소에는 팝업이 없다. [새로 보정]을 누르면 새 프리셋 보정을 시작하고 팝업이 열린다', () => {
    renderSetup();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '새로 보정' }));
    expect(h.startCapture).toHaveBeenCalledWith({ target: 'new' });
    expect(screen.getByRole('dialog', { name: '새 프리셋 보정 · 드럼 위치' })).toBeTruthy();
  });

  it('시스템 기본에서는 [다시 보정]이 비활성이다', () => {
    renderSetup();
    expect((screen.getByRole('button', { name: '다시 보정' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('[그만하기]는 팝업을 닫는다(cancelCapture)', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: '새로 보정' }));
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(h.cancelCapture).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc도 팝업을 닫는다', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: '새로 보정' }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(h.cancelCapture).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('바깥(배경)을 눌러도 닫히지 않는다', () => {
    const { container } = renderSetup();
    fireEvent.click(screen.getByRole('button', { name: '새로 보정' }));
    const backdrop = container.querySelector('.dialog-backdrop')!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(h.cancelCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
