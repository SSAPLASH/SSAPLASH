// @vitest-environment happy-dom
// 키보드 드럼: 수식키(Ctrl/Alt/Meta) 조합은 치지도 막지도 않고, 꺼져 있으면 무시한다
import { afterEach, describe, expect, it } from 'vitest';
import type { StickEvent } from '@/domain/events';
import { KeyboardPadSource } from './KeyboardPadSource';

const sources: KeyboardPadSource[] = [];

async function setup(): Promise<{ src: KeyboardPadSource; hits: StickEvent[] }> {
  const src = new KeyboardPadSource();
  src.setKeys(['KeyI', 'KeyJ', 'Space']);
  const hits: StickEvent[] = [];
  src.subscribe((e) => {
    if (e.kind === 'hit') hits.push(e);
  });
  await src.connect();
  sources.push(src);
  return { src, hits };
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

afterEach(async () => {
  for (const s of sources.splice(0)) await s.disconnect();
});

describe('KeyboardPadSource', () => {
  it('매핑된 키는 타격이 되고 기본 동작을 막는다', async () => {
    const { hits } = await setup();
    const ev = press({ code: 'KeyJ' });
    expect(hits).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it.each([['ctrlKey'], ['altKey'], ['metaKey']])('%s 조합은 치지도 막지도 않는다(개발자 도구 단축키 보호)', async (mod) => {
    const { hits } = await setup();
    const ev = press({ code: 'KeyI', [mod]: true, shiftKey: true });
    expect(hits).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Shift만 누르면 악센트 타격으로 받는다', async () => {
    const { hits } = await setup();
    const plain = press({ code: 'KeyJ' });
    const accent = press({ code: 'KeyJ', shiftKey: true });
    expect(plain.defaultPrevented).toBe(true);
    expect(accent.defaultPrevented).toBe(true);
    expect(hits).toHaveLength(2);
    const [a, b] = hits;
    if (a.kind !== 'hit' || b.kind !== 'hit') throw new Error('hit 아님');
    expect(b.peakAccel).toBeGreaterThan(a.peakAccel);
  });

  it('setEnabled(false)면 무시하고 기본 동작도 막지 않는다', async () => {
    const { src, hits } = await setup();
    src.setEnabled(false);
    const ev = press({ code: 'Space' });
    expect(hits).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(false);
    src.setEnabled(true);
    press({ code: 'Space' });
    expect(hits).toHaveLength(1);
  });
});
