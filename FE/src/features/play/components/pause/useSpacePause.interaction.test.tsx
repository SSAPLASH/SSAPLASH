// @vitest-environment happy-dom
// 연주 중 Space 일시정지: 동글 입력에서만 일시정지 키이고, 그때 Space는 키보드 드럼(킥)으로 새지 않는다.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { spacePauses, useSpacePause } from './useSpacePause';

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

const state = { inSong: true, canPause: true };
const pause = vi.fn();
/** 키보드 드럼 자리: window의 보통(버블) keydown 리스너 */
const kick = vi.fn();
const onKick = (e: KeyboardEvent) => {
  if (e.code === 'Space') kick();
};

function Probe() {
  useSpacePause({ inSong: () => state.inSong, canPause: () => state.canPause, pause });
  return (
    <div>
      <button type="button">버튼</button>
      <div role="dialog">
        <span data-testid="in-dialog" tabIndex={0} />
      </div>
    </div>
  );
}

beforeEach(() => {
  state.inSong = true;
  state.canPause = true;
  pause.mockClear();
  kick.mockClear();
  window.addEventListener('keydown', onKick);
  useSettings.setState({ sensorKind: 'webserial' });
});
afterEach(() => {
  cleanup();
  window.removeEventListener('keydown', onKick);
  useSettings.setState({ sensorKind: 'none' });
});

describe('spacePauses', () => {
  it('페달로 킥을 치는 입력(동글)만 Space가 일시정지 키다', () => {
    expect(spacePauses('webserial')).toBe(true);
    for (const kind of ['none', 'pointer', 'ble', 'websocket']) expect(spacePauses(kind)).toBe(false);
  });
});

describe('useSpacePause', () => {
  it('동글 입력·곡 중: Space로 일시정지하고 킥으로 새지 않는다', () => {
    render(<Probe />);
    const notPrevented = fireEvent.keyDown(document.body, { code: 'Space' });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(kick).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('키보드 전용 입력: Space는 그대로 킥이다', () => {
    useSettings.setState({ sensorKind: 'none' });
    render(<Probe />);
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(pause).not.toHaveBeenCalled();
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('곡 중이 아니면 건드리지 않는다', () => {
    state.inSong = false;
    render(<Probe />);
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(pause).not.toHaveBeenCalled();
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('이미 일시정지 중·복귀 카운트다운 중이면 다시 멈추지 않지만 킥으로도 새지 않는다', () => {
    state.canPause = false;
    render(<Probe />);
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(pause).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  it('버튼·다이얼로그에 초점이 있으면 그 요소의 Space다', () => {
    const r = render(<Probe />);
    fireEvent.keyDown(r.getByRole('button', { name: '버튼' }), { code: 'Space' });
    fireEvent.keyDown(r.getByTestId('in-dialog'), { code: 'Space' });
    expect(pause).not.toHaveBeenCalled();
  });

  it('누르고 있는 반복 입력과 Ctrl·Alt·Meta 조합은 일시정지하지 않는다', () => {
    render(<Probe />);
    fireEvent.keyDown(document.body, { code: 'Space', repeat: true });
    fireEvent.keyDown(document.body, { code: 'Space', ctrlKey: true });
    fireEvent.keyDown(document.body, { code: 'Space', metaKey: true });
    expect(pause).not.toHaveBeenCalled();
  });

  it('다른 키는 지나간다', () => {
    render(<Probe />);
    const notPrevented = fireEvent.keyDown(document.body, { code: 'KeyF' });
    expect(pause).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});
