import { describe, expect, it } from 'vitest';
import { formatDynamicsScore } from './dynamicsRound';
import { formatMiniScore, MINI_CATALOG, miniGameInfo } from './miniCatalog';

describe('MINI_CATALOG', () => {
  it('speed, dynamics 두 줄이 이 순서로 있다', () => {
    expect(MINI_CATALOG.map((game) => game.id)).toEqual(['speed', 'dynamics']);
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
  it('강약중강약 한 줄이 설계와 같다', () => {
    expect(miniGameInfo('dynamics')).toEqual({
      id: 'dynamics',
      name: '강약중강약',
      rule: '내 세기를 재고 숫자에 맞춰 세 번 치기',
      tag: '3타',
      unit: '',
      better: 'lower',
      format: formatDynamicsScore,
    });
  });

  it('단위가 빈 게임(강약중강약)은 표시 함수가 있다', () => {
    for (const game of MINI_CATALOG) {
      if (game.unit === '') expect(game.format).toBeTypeOf('function');
    }
  });

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

  it('강약중강약은 「오차 N」으로 보인다', () => {
    expect(formatMiniScore(miniGameInfo('dynamics'), 14)).toBe('오차 14');
  });

  it('format이 있으면 그 함수 결과를 돌려준다', () => {
    expect(formatMiniScore({ format: (s) => `${s}ms` }, 230)).toBe('230ms');
  });
});
