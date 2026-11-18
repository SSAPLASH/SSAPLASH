// @vitest-environment happy-dom
// 키보드 드럼 스위치: 앱 인스턴스는 꺼진 채로 시작하고, 훅이 켜고 떠날 때 끈다
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StickEvent } from '@/domain/events';
import { setKeyboardDrum, useKeyboardDrum } from './keyboardDrum';
import { keyboardSource } from './sources';

const hits: StickEvent[] = [];
let unsub: (() => void) | undefined;

async function attach(): Promise<void> {
  keyboardSource.setKeys(['KeyJ']);
  unsub = keyboardSource.subscribe((e) => {
    if (e.kind === 'hit') hits.push(e);
  });
  await keyboardSource.connect();
}

function press(): boolean {
  const ev = new KeyboardEvent('keydown', { code: 'KeyJ', cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

afterEach(async () => {
  setKeyboardDrum(false);
  await keyboardSource.disconnect();
  unsub?.();
  hits.length = 0;
});

describe('keyboardDrum', () => {
  it('기본은 꺼져 있어 키를 받지도 막지도 않는다', async () => {
    await attach();
    expect(press()).toBe(false);
    expect(hits).toHaveLength(0);
  });

  it('setKeyboardDrum(true)면 받고 false면 다시 무시한다', async () => {
    await attach();
    setKeyboardDrum(true);
    expect(press()).toBe(true);
    expect(hits).toHaveLength(1);
    setKeyboardDrum(false);
    expect(press()).toBe(false);
    expect(hits).toHaveLength(1);
  });

  it('훅은 active인 동안만 켜고, 비활성·언마운트 때 끈다', async () => {
    await attach();
    const { rerender, unmount } = renderHook(({ on }) => useKeyboardDrum(on), { initialProps: { on: false } });
    expect(press()).toBe(false);
    rerender({ on: true });
    expect(press()).toBe(true);
    rerender({ on: false });
    expect(press()).toBe(false);
    rerender({ on: true });
    unmount();
    expect(press()).toBe(false);
    expect(hits).toHaveLength(1);
  });

  it('두 곳이 겹쳐 쓰면 한 곳이 떠나도 켜져 있고, 둘 다 떠나야 꺼진다(드럼 세팅 화면 위의 박자 맞추기 창)', async () => {
    await attach();
    const page = renderHook(() => useKeyboardDrum(true));
    const dialog = renderHook(() => useKeyboardDrum(true));
    expect(press()).toBe(true);
    dialog.unmount();
    expect(press()).toBe(true);
    page.unmount();
    expect(press()).toBe(false);
  });
});
