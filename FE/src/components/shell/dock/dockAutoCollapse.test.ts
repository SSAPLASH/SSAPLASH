import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_AUTO_COLLAPSE_MS, createDockAutoCollapse } from './dockAutoCollapse';
import { useSettings } from '@/store/settingsStore';

describe('Dock 자동 접힘 상태기계(UX-41)', () => {
  let ctl: ReturnType<typeof createDockAutoCollapse>;
  let collapsed: boolean;
  let unsub: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    ctl = createDockAutoCollapse();
    unsub = ctl.subscribe((c) => (collapsed = c));
  });
  afterEach(() => {
    unsub();
    vi.useRealTimers();
  });

  it('연주가 시작되면(active) 접힌다', () => {
    ctl.setActive(true);
    ctl.expand();
    expect(collapsed).toBe(false);
    ctl.setActive(false);
    ctl.setActive(true);
    expect(collapsed).toBe(true);
  });

  it('알약을 누르면 펼쳐지고 3초 입력이 없으면 다시 접힌다', () => {
    ctl.setActive(true);
    ctl.expand();
    expect(collapsed).toBe(false);
    vi.advanceTimersByTime(DOCK_AUTO_COLLAPSE_MS - 1);
    expect(collapsed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(collapsed).toBe(true);
  });

  it('Dock 안 입력은 타이머를 다시 시작한다', () => {
    ctl.setActive(true);
    ctl.expand();
    vi.advanceTimersByTime(2500);
    ctl.touch();
    vi.advanceTimersByTime(2500);
    expect(collapsed).toBe(false);
    vi.advanceTimersByTime(500);
    expect(collapsed).toBe(true);
  });

  it('메트로놈 패널이 열려 있는 동안은 접지 않고, 닫히면 다시 센다', () => {
    ctl.setActive(true);
    ctl.expand();
    ctl.setPanelOpen(true);
    vi.advanceTimersByTime(DOCK_AUTO_COLLAPSE_MS * 3);
    expect(collapsed).toBe(false);
    ctl.setPanelOpen(false);
    vi.advanceTimersByTime(DOCK_AUTO_COLLAPSE_MS);
    expect(collapsed).toBe(true);
  });

  it('접기 버튼은 즉시 접고 타이머를 남기지 않는다', () => {
    ctl.setActive(true);
    ctl.expand();
    ctl.collapse();
    expect(collapsed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('연주가 멈추면(active=false) 타이머가 정지하고, 구독 해제 시 타이머를 정리한다', () => {
    ctl.setActive(true);
    ctl.expand();
    ctl.setActive(false);
    expect(vi.getTimerCount()).toBe(0);
    ctl.setActive(true);
    ctl.expand();
    unsub();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('저장된 접힘 설정(dockCollapsed)을 바꾸지 않는다', () => {
    const before = useSettings.getState().dockCollapsed;
    ctl.setActive(true);
    ctl.expand();
    vi.advanceTimersByTime(DOCK_AUTO_COLLAPSE_MS);
    ctl.collapse();
    expect(useSettings.getState().dockCollapsed).toBe(before);
  });
});
