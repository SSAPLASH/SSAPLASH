// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import { FxLabPage } from './FxLabPage';

afterEach(cleanup);

const mount = () => {
  MotionGlobalConfig.skipAnimations = true;
  return render(
    <LazyMotion features={domMax} strict>
      <FxLabPage />
    </LazyMotion>,
  );
};

describe('FxLabPage', () => {
  it('A/B 킷 두 개와 성능 표, 개발 빌드의 window.__fxLab API', () => {
    const { unmount } = mount();
    expect(screen.getByLabelText('킷 A')).toBeTruthy();
    expect(screen.getByLabelText('킷 B')).toBeTruthy();
    expect(screen.getByLabelText('성능')).toBeTruthy();
    const api = window.__fxLab!;
    expect(api).toBeTruthy();
    const s = api.stats();
    expect(s.a).toMatchObject({ alive: 0, dropped: 0, running: false });
    expect(s.b).not.toBeNull();
    expect(s.total.alive).toBe(0);
    unmount();
    expect(window.__fxLab).toBeUndefined();
  });

  it('단일 보기는 B가 없고 b 통계는 null', () => {
    mount();
    act(() => window.__fxLab!.setView('single'));
    expect(screen.queryByLabelText('킷 B')).toBeNull();
    expect(window.__fxLab!.stats().b).toBeNull();
  });

  it('패드를 누르면 같은 이벤트가 두 킷에 모두 들어가 파티클이 생긴다', () => {
    mount();
    act(() => window.__fxLab!.setTheme('a', 'auto'));
    act(() => window.__fxLab!.setTheme('b', 'auto'));
    const pad = document.querySelector('.drum-pad');
    expect(pad).toBeTruthy();
    fireEvent.pointerDown(pad!, { pointerType: 'mouse' });
    const s = window.__fxLab!.stats();
    expect(s.a!.alive).toBeGreaterThan(0);
    expect(s.b!.alive).toBe(s.a!.alive);
    expect(s.total.alive).toBe(s.a!.alive * 2);
  });

  it('숫자 키 4는 A 테마를 불로 바꾼다', () => {
    mount();
    fireEvent.keyDown(window, { key: '4' });
    expect((screen.getByLabelText('A 테마') as HTMLSelectElement).value).toBe('fire');
  });

  it('패턴을 고르면 타격이 나온다(스트레스)', async () => {
    mount();
    act(() => window.__fxLab!.setPattern('stress'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(window.__fxLab!.stats().a!.alive).toBeGreaterThan(0);
    act(() => window.__fxLab!.setPattern('off'));
  });

  it('판정 선택: PERFECT는 비판정보다 파티클이 1개 많고, 헛침은 6개, 깨짐 미리보기는 8개', () => {
    mount();
    act(() => window.__fxLab!.setTheme('a', 'auto'));
    act(() => window.__fxLab!.setView('single'));
    const pad = document.querySelector('.drum-pad')!;
    fireEvent.pointerDown(pad, { pointerType: 'mouse' });
    const plain = window.__fxLab!.stats().a!.alive;
    act(() => window.__fxLab!.resetStats());
    act(() => window.__fxLab!.setJudgement('perfect'));
    fireEvent.pointerDown(pad, { pointerType: 'mouse' });
    expect(window.__fxLab!.stats().a!.alive).toBe(plain + 1 + plain);
    act(() => window.__fxLab!.setJudgement('stray'));
    const before = window.__fxLab!.stats().a!.alive;
    fireEvent.pointerDown(pad, { pointerType: 'mouse' });
    expect(window.__fxLab!.stats().a!.alive).toBe(before + 6);
    const before2 = window.__fxLab!.stats().a!.alive;
    fireEvent.click(screen.getByText('깨짐 미리보기'));
    expect(window.__fxLab!.stats().a!.alive).toBe(before2 + 8);
  });
});
