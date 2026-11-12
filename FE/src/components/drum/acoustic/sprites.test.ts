import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIT_ART_PERSP, KIT_ART_TOP } from '@/domain/kit/kitArt';
import { preloadSprites, resetPreloadForTest, spriteUrl } from './sprites';

describe('spriteUrl', () => {
  it('자리 표의 모든 조각 이름이 주소로 풀린다', () => {
    for (const p of KIT_ART_PERSP.pads) {
      expect(spriteUrl(p.sprite), p.sprite).toBeTruthy();
      if (p.top) expect(spriteUrl(p.top.sprite), p.top.sprite).toBeTruthy();
    }
  });

  it('위에서 본 그림도 자리 표의 모든 조각 이름이 top 폴더 주소로 풀린다', () => {
    for (const p of KIT_ART_TOP.pads) {
      expect(spriteUrl(p.sprite, 'top'), p.sprite).toContain('/top/');
      if (p.top) expect(spriteUrl(p.top.sprite, 'top'), p.top.sprite).toContain('/top/');
    }
    expect(spriteUrl('없는-조각', 'top')).toBeUndefined();
  });

  it('모르는 이름이면 undefined', () => {
    expect(spriteUrl('없는-조각')).toBeUndefined();
  });
});

describe('preloadSprites', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPreloadForTest();
  });

  it('원근·위에서 본 그림 조각마다(24장) Image를 한 번씩 만들고, 두 번째 호출은 아무 일도 하지 않는다', () => {
    const made: string[] = [];
    class FakeImage {
      set src(v: string) {
        made.push(v);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    preloadSprites();
    const first = made.length;
    expect(first).toBe(24);
    preloadSprites();
    expect(made.length).toBe(first);
  });

  it('Image가 없는 환경에서는 조용히 넘어간다', () => {
    vi.stubGlobal('Image', undefined);
    expect(() => preloadSprites()).not.toThrow();
  });
});
