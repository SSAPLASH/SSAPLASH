// @vitest-environment happy-dom
// 드럼 세팅 단계 팝업(PLAY-004 D8): 타일을 눌러야 열리고, 보정 중에는 ②를 열 수 없다
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { SYSTEM_PRESET_ID } from '@/domain/kit/preset';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { SetupPage } from './SetupPage';

const initialSettings = useSettings.getState();
const initialLive = useLive.getState();
const initialPresets = usePresets.getState();

function renderSetup() {
  const router = createMemoryRouter([{ path: '/setup', element: <SetupPage /> }], { initialEntries: ['/setup'] });
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  useSettings.setState(initialSettings, true);
  useLive.setState(initialLive, true);
  usePresets.setState(initialPresets, true);
});

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
    lastAccepted: null,
    radiusOverrides: {},
  },
  realign: null,
  hands: [0, 1],
};

describe('SetupPage 단계 팝업', () => {
  it('진입하면 모자란 단계가 있어도 dialog가 없다', () => {
    useSettings.setState({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: 'p1' });
    useLive.setState({ connected: [false, false] });
    renderSetup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /스틱 연결/ }).textContent).toContain('연결하기');
  });

  it('스틱·페달 연결 타일을 누르면 「스틱·페달 연결」 팝업에 연결 내용(페달 줄 포함)이 보이고 닫으면 타일로 포커스가 돌아온다', () => {
    useSettings.setState({ sensorKind: 'webserial' });
    renderSetup();
    const tile = screen.getByRole('button', { name: /스틱·페달 연결/ });
    tile.focus();
    fireEvent.click(tile);
    const dialog = screen.getByRole('dialog', { name: '스틱·페달 연결' });
    expect(dialog.textContent).toContain('페달 연결 안 됨');
    expect(dialog.textContent).toContain('키보드는 항상 켜져 있습니다');
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it('시작 위치 보정 타일을 누르면 팝업 안에 [시작 위치 맞추기]와 드럼 배치 안내가 보인다', () => {
    useSettings.setState({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: 'p1' });
    useLive.setState({ connected: [true, true] });
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: /시작 위치 보정/ }));
    const dialog = screen.getByRole('dialog', { name: '시작 위치 보정' });
    expect(within(dialog).getByRole('button', { name: /시작 위치 맞추기/ })).toBeTruthy();
    expect(dialog.textContent).toContain('[다시 보정] 또는 [새로 보정]');
  });

  it('보정 중에는 시작 위치 보정 타일이 비활성이라 팝업을 열 수 없다', () => {
    useSettings.setState({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    useLive.setState({ connected: [true, true], calibration: CAPTURING } as never);
    renderSetup();
    const tile = screen.getByRole('button', { name: /시작 위치 보정/ }) as HTMLButtonElement;
    expect(tile.disabled).toBe(true);
    fireEvent.click(tile);
    // 보정 중에는 보정 팝업만 열려 있고 ② 단계 팝업은 열리지 않는다
    expect(screen.queryByRole('dialog', { name: '시작 위치 보정' })).toBeNull();
  });

  it('재정렬이 필요해져도 팝업은 자동으로 열리지 않고 타일만 강조된다', () => {
    useSettings.setState({ sensorKind: 'pointer', stickAnchors: [{ SNARE: { pad: 'SNARE', pitch: 0, yaw: 0, radius: 18, samples: 2, spread: 1 } }, { SNARE: { pad: 'SNARE', pitch: 0, yaw: 0, radius: 18, samples: 2, spread: 1 } }], activePresetId: 'p1' });
    useLive.setState({ connected: [true, true], realignNeeded: [false, true] });
    renderSetup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /시작 위치 보정/ }).className).toContain('is-attention');
  });
});

describe('SetupPage 자동 보정 멈춤 표시', () => {
  it('멈춘 손이 있으면 연결 팝업 상태 줄에 「자동 보정 멈춤(방향 흔들림)」을 알리고, 그 손의 「잠시 뒤 보정」은 내지 않는다', () => {
    const st = { appliedDeg: -8, samples: 0, lastErrorDeg: 8, lastSentAt: performance.now(), acked: true, halted: true };
    useSettings.setState({ sensorKind: 'webserial' });
    useLive.setState({ connected: [true, false], yawDrift: [st, null] });
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: /스틱·페달 연결/ }));
    const text = screen.getByRole('dialog', { name: '스틱·페달 연결' }).textContent ?? '';
    expect(text).toContain('자동 보정 멈춤(방향 흔들림)');
    expect(text).not.toContain('잠시 뒤 보정');
  });
});
