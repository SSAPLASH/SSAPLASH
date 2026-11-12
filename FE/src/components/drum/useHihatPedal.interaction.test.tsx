// @vitest-environment happy-dom
// useHihatPedal 표: 소리와 같은 규칙(왼발 페달이 연결되어 있고 밟지 않았을 때만 열림). liveStore 변화를 실제로 구독한다.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { initialPedal, useLive } from '@/store/liveStore';
import { useHihatPedal } from './useHihatPedal';

function setPedal(connected: boolean, hihatClosed: boolean) {
  useLive.setState({ pedal: { ...initialPedal(), connected: [connected, false], hihatClosed } });
}

describe('useHihatPedal', () => {
  afterEach(() => {
    cleanup();
    useLive.setState({ pedal: initialPedal() });
  });

  it.each([
    { connected: true, hihatClosed: false, expected: { closed: false, pedalOff: false } },
    { connected: true, hihatClosed: true, expected: { closed: true, pedalOff: false } },
    { connected: false, hihatClosed: false, expected: { closed: true, pedalOff: true } },
    { connected: false, hihatClosed: true, expected: { closed: true, pedalOff: true } },
  ])('연결 $connected · 밟힘 $hihatClosed → $expected', ({ connected, hihatClosed, expected }) => {
    setPedal(connected, hihatClosed);
    const { result } = renderHook(() => useHihatPedal());
    expect(result.current).toEqual(expected);
  });

  it('스토어가 바뀌면 값이 따라가고, 관계없는 갱신에는 다시 그리지 않는다', () => {
    setPedal(true, true);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useHihatPedal();
    });
    expect(result.current.closed).toBe(true);
    act(() => setPedal(true, false));
    expect(result.current).toEqual({ closed: false, pedalOff: false });
    const before = renders;
    act(() => useLive.setState({ hitSeq: useLive.getState().hitSeq + 1 }));
    expect(renders).toBe(before);
  });
});
