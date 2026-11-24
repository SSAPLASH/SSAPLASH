import { describe, expect, it } from 'vitest';
import { formatMiniScore, MINI_CATALOG, miniGameInfo } from './miniCatalog';

describe('MINI_CATALOG', () => {
  it('지금은 speed 한 줄뿐이다', () => {
    expect(MINI_CATALOG).toHaveLength(1);
    expect(MINI_CATALOG[0]).toEqual({
      id: 'speed',
      name: '누구보다 빠르게',
      rule: '10초 동안 스네어 가장 많이 치기',
      tag: '10초',
      unit: '타',
      better: 'higher',
    });
  });
});

describe('miniGameInfo', () => {
  it('게임 id의 표 한 줄을 돌려준다', () => {
    expect(miniGameInfo('speed').name).toBe('누구보다 빠르게');
  });

  it('표에 없는 id면 던진다', () => {
    expect(() => miniGameInfo('ghost' as never)).toThrow();
  });
});

describe('formatMiniScore', () => {
  it('format이 없으면 숫자 그대로 글자로 돌려준다', () => {
    expect(formatMiniScore({}, 42)).toBe('42');
    expect(formatMiniScore(miniGameInfo('speed'), 7)).toBe('7');
  });

  it('format이 있으면 그 함수 결과를 돌려준다', () => {
    expect(formatMiniScore({ format: (s) => `${s}ms` }, 230)).toBe('230ms');
  });
});
