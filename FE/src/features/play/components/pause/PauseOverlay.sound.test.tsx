// @vitest-environment happy-dom
// 일시정지 팝업 음량(QA 352 Q10): 설정값을 바꾸고, 반주 없는 곡은 노래 음량을 끄며, 슬라이더 키가 드럼 타격으로 새지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KeyboardPadSource } from '@/input/source/KeyboardPadSource';
import { setReconnectHandler } from '@/store/reconnectStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { PauseOverlay } from './PauseOverlay';

// Node 실험적 localStorage가 happy-dom 것을 가려 persist 저장이 실패한다 — import 전에 메모리 저장소로 대체한다
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

const noop = () => {};

function setup(props: { hasAccompaniment?: boolean; reason?: 'user' | 'disconnected' } = {}) {
  return render(
    <MemoryRouter>
      <PauseOverlay reason={props.reason ?? 'user'} canResume onResume={noop} onRestart={noop} onLeave={noop} returnTo="/play" hasAccompaniment={props.hasAccompaniment} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setReconnectHandler(null);
  useSettings.setState({ drumVolume: 1, songVolume: 1 });
  useShellStore.setState({ dockRaised: false });
});
afterEach(cleanup);

describe('PauseOverlay 음량', () => {
  it('드럼·노래 음량 슬라이더가 설정과 같은 범위·값으로 보인다', () => {
    useSettings.setState({ drumVolume: 1.5, songVolume: 0.6 });
    setup();
    const drum = screen.getByLabelText('드럼 음량') as HTMLInputElement;
    const song = screen.getByLabelText('노래 음량(반주)') as HTMLInputElement;
    expect([drum.min, drum.max, drum.step, drum.value]).toEqual(['0', '2', '0.05', '1.5']);
    expect([song.min, song.max, song.step, song.value]).toEqual(['0', '1', '0.05', '0.6']);
    expect(screen.getByText('150%')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('슬라이더를 움직이면 설정값이 바뀐다', () => {
    setup();
    fireEvent.change(screen.getByLabelText('드럼 음량'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('노래 음량(반주)'), { target: { value: '0.4' } });
    expect(useSettings.getState().drumVolume).toBe(1.25);
    expect(useSettings.getState().songVolume).toBe(0.4);
  });

  it('반주가 있으면(기본) 노래 음량이 활성이고 안내 문구가 없다', () => {
    setup();
    expect((screen.getByLabelText('노래 음량(반주)') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('이 곡은 반주가 없어요')).toBeNull();
  });

  it('반주가 없는 곡이면 노래 음량만 비활성이고 안내 문구를 보인다', () => {
    setup({ hasAccompaniment: false });
    expect((screen.getByLabelText('노래 음량(반주)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('드럼 음량') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('이 곡은 반주가 없어요')).toBeTruthy();
  });

  it('반주가 없는 곡은 노래 줄에 흐림 묶음 클래스가 붙고, 드럼 줄에는 없다', () => {
    const { container } = setup({ hasAccompaniment: false });
    const off = container.querySelectorAll('.play-pause-sound-off');
    expect(off).toHaveLength(1);
    expect(off[0].querySelector('#' + CSS.escape((screen.getByLabelText('노래 음량(반주)') as HTMLInputElement).id))).toBeTruthy();
    // 라벨은 흐림 대상이 아니다(CSS가 값·트랙 줄만 흐리게 한다) — 라벨 요소는 그대로 존재
    expect(off[0].querySelector('.ui-slider-label')?.textContent).toBe('노래 음량(반주)');
  });

  it('반주가 있으면 흐림 묶음 클래스가 없다', () => {
    const { container } = setup();
    expect(container.querySelector('.play-pause-sound-off')).toBeNull();
  });

  it('팝업이 떠 있는 동안 Dock 승격 플래그가 켜지고, 닫히면 꺼진다(일시정지·끊김 모두)', () => {
    const a = setup();
    expect(useShellStore.getState().dockRaised).toBe(true);
    a.unmount();
    expect(useShellStore.getState().dockRaised).toBe(false);
    setup({ reason: 'disconnected' });
    expect(useShellStore.getState().dockRaised).toBe(true);
  });
});

describe('슬라이더 키는 드럼 타격으로 새지 않는다', () => {
  it('팝업 슬라이더에 초점이 있을 때 방향키·Space·연주 키를 키보드 소스가 치지도 막지도 않는다', async () => {
    const src = new KeyboardPadSource();
    src.setKeys(['ArrowLeft', 'ArrowUp', 'Space', 'KeyJ']);
    const hits: unknown[] = [];
    src.subscribe((e) => {
      if (e.kind === 'hit') hits.push(e);
    });
    await src.connect();
    setup();
    const slider = screen.getByLabelText('드럼 음량');
    act(() => slider.focus());
    for (const code of ['ArrowLeft', 'ArrowUp', 'Space', 'KeyJ']) {
      const ev = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
      slider.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(hits).toHaveLength(0);
    await src.disconnect();
  });
});
