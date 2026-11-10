// @vitest-environment happy-dom
// 포인터 모의 스틱 클릭 타격은 드럼 킷 영역([data-pointer-strike]) 안에서만 친다(QA 352)
import { afterEach, describe, expect, it } from 'vitest';
import type { StickEvent } from '@/domain/events';
import { isPointerStrikeTarget, PointerStickSource } from './PointerStickSource';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isPointerStrikeTarget', () => {
  it('킷 영역 밖(배경)은 타격이 아니다', () => {
    const host = el('<main><p id="bg">배경</p></main>');
    expect(isPointerStrikeTarget(host.querySelector('#bg'))).toBe(false);
  });

  it('킷 영역 안은 타격, SVG 자식도 포함', () => {
    const host = el('<svg data-pointer-strike=""><circle id="pad" r="5"></circle></svg>');
    expect(isPointerStrikeTarget(host.querySelector('#pad'))).toBe(true);
  });

  it('킷 영역 안이라도 버튼·터치 패드·편집기는 타격이 아니다', () => {
    const host = el('<div data-pointer-strike=""><button id="b">b</button><div data-no-pointer-strike=""><span id="e">e</span></div></div>');
    expect(isPointerStrikeTarget(host.querySelector('#b'))).toBe(false);
    expect(isPointerStrikeTarget(host.querySelector('#e'))).toBe(false);
  });

  it('요소가 아니면 타격이 아니다', () => {
    expect(isPointerStrikeTarget(null)).toBe(false);
    expect(isPointerStrikeTarget(window)).toBe(false);
  });
});

describe('PointerStickSource 클릭 타격', () => {
  it('배경 클릭은 무시하고 킷 클릭은 왼손·오른손 타격', async () => {
    const src = new PointerStickSource();
    const hits: StickEvent[] = [];
    const off = src.subscribe((e) => {
      if (e.kind === 'hit') hits.push(e);
    });
    await src.connect();
    try {
      const host = el('<p id="bg">배경</p><div data-pointer-strike=""><span id="kit">킷</span></div>');
      host.querySelector('#bg')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      expect(hits).toHaveLength(0);
      const kit = host.querySelector('#kit')!;
      kit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      kit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
      expect(hits.map((h) => h.kind === 'hit' && h.stickId)).toEqual([0, 1]);
    } finally {
      off();
      await src.disconnect();
    }
  });
});

describe('PointerStickSource 키 타격의 수식키', () => {
  async function run(init: KeyboardEventInit): Promise<{ hits: number; prevented: boolean }> {
    const src = new PointerStickSource();
    let hits = 0;
    src.subscribe((e: StickEvent) => {
      if (e.kind === 'hit') hits++;
    });
    await src.connect();
    const ev = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
    window.dispatchEvent(ev);
    await src.disconnect();
    return { hits, prevented: ev.defaultPrevented };
  }

  it('수식키 없이 타격 키를 누르면 친다', async () => {
    expect(await run({ code: 'KeyJ' })).toEqual({ hits: 1, prevented: true });
  });

  it.each([['ctrlKey'], ['altKey'], ['metaKey']])('%s 조합은 치지도 막지도 않는다', async (mod) => {
    expect(await run({ code: 'KeyJ', [mod]: true, shiftKey: true })).toEqual({ hits: 0, prevented: false });
  });

  it('Shift만이면 악센트로 친다', async () => {
    expect(await run({ code: 'KeyF', shiftKey: true })).toEqual({ hits: 1, prevented: true });
  });
});
