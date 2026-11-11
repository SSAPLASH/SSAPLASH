import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLive, initialPedal } from '@/store/liveStore';
import { handDropped, pedalDropped, usePauseTriggers } from './usePauseTriggers';

// 렌더 라이브러리가 없어 useEffect를 즉시 실행으로 바꿔 구독 로직만 시험한다
const cleanups = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', () => ({
  useEffect: (fn: () => (() => void) | void) => {
    const c = fn();
    if (c) cleanups.push(c);
  },
}));
const settings = vi.hoisted(() => ({ sensorKind: 'webserial' as string }));
vi.mock('@/store/settingsStore', () => ({ useSettings: { getState: () => settings } }));

describe('handDropped', () => {
  it('한 손만 끊겨도 참', () => {
    expect(handDropped([true, true], [true, false])).toBe(true);
    expect(handDropped([true, true], [false, true])).toBe(true);
    expect(handDropped([true, true], [false, false])).toBe(true);
  });
  it('끊김 전이가 없으면 거짓(새로 붙거나 그대로)', () => {
    expect(handDropped([false, false], [true, false])).toBe(false);
    expect(handDropped([true, false], [true, false])).toBe(false);
    expect(handDropped([false, true], [true, true])).toBe(false);
  });
});

describe('pedalDropped', () => {
  it('한 발만 끊겨도 참', () => {
    expect(pedalDropped([true, true], [false, true])).toBe(true);
    expect(pedalDropped([true, true], [true, false])).toBe(true);
    expect(pedalDropped([true, true], [false, false])).toBe(true);
  });
  it('끊김 전이가 없으면 거짓', () => {
    expect(pedalDropped([false, false], [true, false])).toBe(false);
    expect(pedalDropped([true, false], [true, false])).toBe(false);
    expect(pedalDropped([false, true], [true, true])).toBe(false);
  });
});

describe('usePauseTriggers 발 끊김 (PLAY-002 D3)', () => {
  const pauseTo = vi.fn();

  beforeEach(() => {
    for (const c of cleanups.splice(0)) c(); // 이전 테스트의 구독 해제
    pauseTo.mockClear();
    useLive.setState({ connected: [true, true], pedal: { ...initialPedal(), connected: [true, true] }, pauseRequested: null });
  });

  function useMount() {
    usePauseTriggers(pauseTo);
  }

  // 인수 조건: 곡 연주 중 페달이 끊기면 손과 같이 일시정지(disconnected)
  it('센서 모드에서 발 연결→끊김이면 pauseTo(disconnected)', () => {
    settings.sensorKind = 'webserial';
    useMount();
    useLive.setState({ pedal: { ...initialPedal(), connected: [true, false] } });
    expect(pauseTo).toHaveBeenCalledWith('disconnected');
  });

  // 인수 조건: 키보드 전용은 면제
  it('키보드 전용(none)이면 발이 끊겨도 멈추지 않는다', () => {
    settings.sensorKind = 'none';
    useMount();
    useLive.setState({ pedal: { ...initialPedal(), connected: [false, false] } });
    expect(pauseTo).not.toHaveBeenCalled();
  });

  it('발이 새로 붙을 때(끊김→연결)는 멈추지 않는다', () => {
    settings.sensorKind = 'webserial';
    useLive.setState({ pedal: { ...initialPedal(), connected: [false, false] } });
    useMount();
    useLive.setState({ pedal: { ...initialPedal(), connected: [true, true] } });
    expect(pauseTo).not.toHaveBeenCalled();
  });
});
