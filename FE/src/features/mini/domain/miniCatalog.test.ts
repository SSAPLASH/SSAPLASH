import { describe, expect, it } from 'vitest';
import { formatDynamicsScore } from './dynamicsRound';
import { formatMiniScore, MINI_CATALOG, miniGameInfo } from './miniCatalog';

describe('MINI_CATALOG', () => {
  it('speed, dynamics, sight, tempo, crescendo, oneshot 여섯 줄이 이 순서로 있다', () => {
    expect(MINI_CATALOG.map((game) => game.id)).toEqual(['speed', 'dynamics', 'sight', 'tempo', 'crescendo', 'oneshot']);
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

describe('악보 보고 빨리 치기(sight)', () => {
  it('표 한 줄이 설계와 같다', () => {
    const info = miniGameInfo('sight');
    expect(info.name).toBe('악보 보고 빨리 치기');
    expect(info.rule).toBe('음표가 뜨면 맞는 패드를 바로 치기');
    expect(info.tag).toBe('10문제');
    expect(info.unit).toBe('초');
    expect(info.better).toBe('lower');
    expect(info.variants?.map((v) => v.id)).toEqual(['hint-off', 'hint-on']);
  });

  it('점수는 초 소수 둘째 자리로 보인다', () => {
    expect(formatMiniScore(miniGameInfo('sight'), 420)).toBe('0.42');
  });
});

describe('인간 메트로놈(tempo)', () => {
  it('목록은 speed, dynamics, sight, tempo, crescendo, oneshot 순서', () => {
    expect(MINI_CATALOG.map((game) => game.id)).toEqual(['speed', 'dynamics', 'sight', 'tempo', 'crescendo', 'oneshot']);
  });

  it('표 한 줄이 설계와 같다', () => {
    const info = miniGameInfo('tempo');
    expect(info.name).toBe('인간 메트로놈');
    expect(info.rule).toBe('소리가 꺼져도 같은 빠르기로 치기');
    expect(info.tag).toBe('16타');
    expect(info.unit).toBe('ms');
    expect(info.better).toBe('lower');
    expect(info.format).toBeUndefined();
    expect(info.variants).toBeUndefined();
  });

  it('점수는 숫자 그대로 보인다', () => {
    expect(formatMiniScore(miniGameInfo('tempo'), 14)).toBe('14');
  });
});

describe('어디까지 올라가는 거예요?(crescendo)', () => {
  it('표 한 줄이 설계와 같다', () => {
    const info = miniGameInfo('crescendo');
    expect(info.name).toBe('어디까지 올라가는 거예요?');
    expect(info.rule).toBe('앞 타격보다 조금씩 더 세게 치기');
    expect(info.tag).toBe('약하면 끝');
    expect(info.unit).toBe('번');
    expect(info.better).toBe('higher');
    expect(info.format).toBeUndefined();
    expect(info.variants).toBeUndefined();
  });

  it('점수는 숫자 그대로 보인다', () => {
    expect(formatMiniScore(miniGameInfo('crescendo'), 9)).toBe('9');
  });
});

describe('정적 뒤 한 방(oneshot)', () => {
  it('표 한 줄이 설계와 같다', () => {
    const info = miniGameInfo('oneshot');
    expect(info.name).toBe('정적 뒤 한 방');
    expect(info.rule).toBe('노래가 멈춘 뒤 정확한 박에 한 방');
    expect(info.tag).toBe('이벤트');
    expect(info.unit).toBe('ms');
    expect(info.better).toBe('lower');
    expect(info.variants?.map((v) => v.id)).toEqual(['iwaly']);
    expect(info.format).toBeUndefined();
  });
});
