// @vitest-environment happy-dom
// useRealign 훅 검증(PLAY-004 3-9): 재정렬이 필요한 손이 생기면 세션을 자동 시작하고, enabled가 꺼지면 접는다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRealign } from './useRealign';
import { calibrationSession } from '@/runtime/calibrationSession';
import { inputManager } from '@/runtime/sources';
import { BaseInputSource } from '@/input/source/InputSource';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import type { InputSourceKind, SourceState, StickId } from '@/domain/events';

class MockSource extends BaseInputSource {
  readonly kind = 'ble' as InputSourceKind;
  readonly label = 'mock';
  sendCommand(_bytes: Uint8Array, _stickId?: StickId): void {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

const snare = { pad: 'SNARE' as const, pitch: -20, yaw: 0, radius: 18, samples: 2, spread: 1 };

beforeEach(async () => {
  calibrationSession.resetForTest();
  padTableSync.reset();
  yawDriftMonitor.resetAll();
  const src = new MockSource();
  await inputManager.attach(src);
  padTableSync.setSource(src);
  yawDriftMonitor.setSource(src);
  src.set('connected');
  useSettings.setState({ stickAnchors: [{ SNARE: snare }, { SNARE: snare }] });
  useLive.setState({ activeSensor: 'ble', connected: [true, true], realignNeeded: [false, false] });
});
afterEach(async () => {
  cleanup();
  await inputManager.detach('ble');
  calibrationSession.resetForTest();
});

describe('useRealign', () => {
  it('realignNeeded가 켜지면 세션을 시작해 pending·info를 내고, 건너뛰기로 끝난다', () => {
    const { result } = renderHook(() => useRealign(true));
    expect(result.current.pending).toBe(false);
    act(() => useLive.setState({ realignNeeded: [false, true] }));
    expect(result.current.pending).toBe(true);
    expect(result.current.info?.hands).toEqual([1]);
    act(() => result.current.skip());
    expect(result.current.pending).toBe(false);
    expect(useLive.getState().realignNeeded).toEqual([false, false]);
  });

  it('enabled가 아니면 시작하지 않고, 켜졌다 꺼지면 취소(realignNeeded는 남는다)', () => {
    useLive.setState({ realignNeeded: [true, false] });
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useRealign(on), { initialProps: { on: false } });
    expect(result.current.pending).toBe(false);
    rerender({ on: true });
    expect(result.current.pending).toBe(true);
    rerender({ on: false });
    expect(result.current.pending).toBe(false);
    expect(useLive.getState().realignNeeded).toEqual([true, false]);
  });

  it('앵커가 없는 손만 필요하면 시작하지 않는다', () => {
    useSettings.setState({ stickAnchors: [null, { SNARE: snare }] });
    useLive.setState({ realignNeeded: [true, false] });
    const { result } = renderHook(() => useRealign(true));
    expect(result.current.pending).toBe(false);
  });

  it('언마운트하면 세션을 접는다', () => {
    useLive.setState({ realignNeeded: [true, true] });
    const { unmount } = renderHook(() => useRealign(true));
    expect(useLive.getState().calibration.mode).toBe('realign');
    unmount();
    expect(useLive.getState().calibration.mode).toBe('idle');
  });
});
