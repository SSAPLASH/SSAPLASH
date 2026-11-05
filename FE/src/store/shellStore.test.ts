import { beforeEach, describe, expect, it } from 'vitest';
import { useShellStore } from './shellStore';

describe('shellStore', () => {
  beforeEach(() => {
    useShellStore.setState({ title: '', immersive: false, dockPanel: null });
  });

  it('초기값: title 빈 문자열 · immersive false · dockPanel null', () => {
    const s = useShellStore.getState();
    expect(s.title).toBe('');
    expect(s.immersive).toBe(false);
    expect(s.dockPanel).toBeNull();
  });

  it('setShell은 넘긴 필드만 갱신한다', () => {
    useShellStore.getState().setShell({ title: '리듬 게임' });
    expect(useShellStore.getState()).toMatchObject({ title: '리듬 게임', immersive: false });
    useShellStore.getState().setShell({ immersive: true });
    expect(useShellStore.getState()).toMatchObject({ title: '리듬 게임', immersive: true });
  });

  it('setShell은 dockPanel을 건드리지 않는다', () => {
    useShellStore.getState().setDockPanel('metronome');
    useShellStore.getState().setShell({ title: 'x', immersive: true });
    expect(useShellStore.getState().dockPanel).toBe('metronome');
  });

  it('setDockPanel은 패널을 열고 닫는다', () => {
    useShellStore.getState().setDockPanel('metronome');
    expect(useShellStore.getState().dockPanel).toBe('metronome');
    useShellStore.getState().setDockPanel(null);
    expect(useShellStore.getState().dockPanel).toBeNull();
  });
});
