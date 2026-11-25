import { describe, expect, it } from 'vitest';
import {
  acceptsShot,
  canStartVelocityGame,
  collectVelocities,
  isWrongPad,
  SHOT_GUARD_MS,
  toVelocity,
  velocityRatio,
  VELOCITY_MAX,
  VELOCITY_MIN,
  VELOCITY_PAD,
  WRONG_PAD_HINT_MS,
} from './velocityShot';

const START = 5000;

/** 타격. 타격 시각과 받은 시각이 같고 센서 소스인 스네어가 기본이다 */
function hit(t: number, velocity = 64, over: { pad?: string | null; source?: string | undefined; tRecv?: number; tHit?: number } = {}) {
  const base = { pad: 'SNARE', source: 'serial', tHit: t, tRecv: t, velocity };
  return { ...base, ...over } as unknown as Parameters<typeof collectVelocities>[1][number];
}

function acc(h: unknown, since: number): boolean {
  return acceptsShot(h as Parameters<typeof acceptsShot>[0], since);
}

describe('상수', () => {
  it('값이 설계와 같다', () => {
    expect(VELOCITY_PAD).toBe('SNARE');
    expect(VELOCITY_MIN).toBe(1);
    expect(VELOCITY_MAX).toBe(127);
    expect(SHOT_GUARD_MS).toBe(300);
    expect(WRONG_PAD_HINT_MS).toBe(1500);
  });
});

describe('acceptsShot', () => {
  it('센서 소스의 스네어는 보호 시간 정확히 뒤에 받고 1ms 전엔 받지 않는다', () => {
    expect(acc(hit(START + 300), START)).toBe(true);
    expect(acc(hit(START + 299), START)).toBe(false);
  });

  it('키보드·터치·미리듣기·소스 없음은 스네어여도 받지 않는다', () => {
    for (const source of ['keyboard', 'touch', 'preview', undefined]) {
      expect(acc(hit(START + 1000, 64, { source }), START)).toBe(false);
    }
  });

  it('그 밖의 소스(pointer·ble·serial)는 받는다', () => {
    for (const source of ['pointer', 'ble', 'serial']) {
      expect(acc(hit(START + 1000, 64, { source }), START)).toBe(true);
    }
  });

  it('스네어가 아닌 패드와 패드 없음은 받지 않는다', () => {
    expect(acc(hit(START + 1000, 64, { pad: 'HIHAT' }), START)).toBe(false);
    expect(acc(hit(START + 1000, 64, { pad: 'KICK' }), START)).toBe(false);
    expect(acc(hit(START + 1000, 64, { pad: null }), START)).toBe(false);
  });

  it('시각은 타격 시각과 받은 시각 중 이른 쪽이다', () => {
    // 타격 시각이 이르면 그것을 쓴다
    expect(acc(hit(0, 64, { tHit: START + 299, tRecv: START + 500 }), START)).toBe(false);
    expect(acc(hit(0, 64, { tHit: START + 300, tRecv: START + 500 }), START)).toBe(true);
    // 받은 시각이 이르면 그것을 쓴다
    expect(acc(hit(0, 64, { tHit: START + 500, tRecv: START + 299 }), START)).toBe(false);
    expect(acc(hit(0, 64, { tHit: START + 500, tRecv: START + 300 }), START)).toBe(true);
  });

  it('타격 시각이 숫자가 아니면 받은 시각을 쓴다', () => {
    expect(acc(hit(0, 64, { tHit: Number.NaN, tRecv: START + 300 }), START)).toBe(true);
    expect(acc(hit(0, 64, { tHit: Number.NaN, tRecv: START + 299 }), START)).toBe(false);
  });
});

describe('isWrongPad', () => {
  const wrong = (h: unknown) => isWrongPad(h as Parameters<typeof isWrongPad>[0]);

  it('센서 소스에서 스네어가 아닌 패드면 참', () => {
    expect(wrong({ pad: 'HIHAT', source: 'serial' })).toBe(true);
    expect(wrong({ pad: 'KICK', source: 'ble' })).toBe(true);
  });

  it('센서 소스의 스네어는 거짓', () => {
    expect(wrong({ pad: 'SNARE', source: 'serial' })).toBe(false);
  });

  it('센서 소스에서 패드 없음은 거짓', () => {
    expect(wrong({ pad: null, source: 'serial' })).toBe(false);
  });

  it('키보드의 다른 패드는 거짓', () => {
    expect(wrong({ pad: 'HIHAT', source: 'keyboard' })).toBe(false);
  });
});

describe('velocityRatio', () => {
  it('1은 0, 127은 1, 64는 0.5', () => {
    expect(velocityRatio(1)).toBe(0);
    expect(velocityRatio(127)).toBe(1);
    expect(velocityRatio(64)).toBe(0.5);
  });

  it('눈금 밖은 0~1로 자른다', () => {
    expect(velocityRatio(0)).toBe(0);
    expect(velocityRatio(200)).toBe(1);
  });
});

describe('toVelocity', () => {
  it('소수는 반올림한다(41.4 → 41, 41.5 → 42)', () => {
    expect(toVelocity(41.4)).toBe(41);
    expect(toVelocity(41.5)).toBe(42);
  });

  it('1 아래는 1, 127 위는 127로 자른다', () => {
    expect(toVelocity(0)).toBe(1);
    expect(toVelocity(-5)).toBe(1);
    expect(toVelocity(200)).toBe(127);
  });

  it('눈금 안의 정수는 그대로다', () => {
    expect(toVelocity(1)).toBe(1);
    expect(toVelocity(64)).toBe(64);
    expect(toVelocity(127)).toBe(127);
  });
});

describe('collectVelocities', () => {
  it('받을 타격의 세기만 받은 순서대로 모은다', () => {
    expect(collectVelocities(START, [hit(START + 300, 42), hit(START + 700, 78), hit(START + 1200, 109)])).toEqual([42, 78, 109]);
  });

  it('기준 시각 뒤 299ms는 버리고 300ms부터 받는다', () => {
    expect(collectVelocities(START, [hit(START + 299, 90)])).toEqual([]);
    expect(collectVelocities(START, [hit(START + 300, 90)])).toEqual([90]);
  });

  it('받은 타격 뒤 299ms 안의 타격은 버리고 300ms 뒤의 것은 받는다', () => {
    expect(collectVelocities(START, [hit(START + 400, 40), hit(START + 699, 11), hit(START + 700, 70)])).toEqual([40, 70]);
  });

  it('기준 시각보다 이른 타격은 빠진다', () => {
    expect(collectVelocities(START, [hit(START - 1000, 55), hit(START - 1, 56), hit(START + 300, 90)])).toEqual([90]);
  });

  it('다른 패드·키보드·패드 판정 없는 타격은 받지 않고 기준 시각도 바꾸지 않는다', () => {
    const velocities = collectVelocities(START, [
      hit(START + 400, 40),
      hit(START + 500, 1, { pad: 'HIHAT' }),
      hit(START + 600, 2, { source: 'keyboard' }),
      hit(START + 650, 3, { pad: null }),
      // 위 타격들이 기준을 옮겼다면 받지 못할 시각(첫 타격 +300 = 700)
      hit(START + 700, 70),
    ]);
    expect(velocities).toEqual([40, 70]);
  });

  it('limit개까지만 받는다', () => {
    const hits = [hit(START + 300, 10), hit(START + 700, 20), hit(START + 1200, 30), hit(START + 2000, 40)];
    expect(collectVelocities(START, hits, 3)).toEqual([10, 20, 30]);
    expect(collectVelocities(START, hits, 1)).toEqual([10]);
  });

  it('limit을 주지 않으면 끝까지 받는다', () => {
    const hits = Array.from({ length: 10 }, (_, i) => hit(START + 300 + i * 400, 20 + i));
    expect(collectVelocities(START, hits)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it('세기는 1~127 정수로 맞춘다', () => {
    expect(collectVelocities(START, [hit(START + 300, 0), hit(START + 700, 63.6), hit(START + 1200, 200)])).toEqual([1, 64, 127]);
  });

  it('타격이 없으면 빈 배열', () => {
    expect(collectVelocities(START, [])).toEqual([]);
  });
});

describe('canStartVelocityGame', () => {
  const states: [boolean, boolean][] = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];

  it('센서를 고르지 않았으면 나머지와 상관없이 거짓', () => {
    for (const connected of states) {
      expect(canStartVelocityGame('none', false, connected)).toBe(false);
      expect(canStartVelocityGame('none', true, connected)).toBe(false);
    }
  });

  it('연결이 필요한 센서는 한 손 이상 연결돼야 참', () => {
    expect(canStartVelocityGame('serial', false, [false, false])).toBe(false);
    expect(canStartVelocityGame('serial', false, [true, false])).toBe(true);
    expect(canStartVelocityGame('serial', false, [false, true])).toBe(true);
    expect(canStartVelocityGame('serial', false, [true, true])).toBe(true);
  });

  it('연결 개념이 없는 소스는 연결과 상관없이 참', () => {
    for (const connected of states) expect(canStartVelocityGame('pointer', true, connected)).toBe(true);
  });
});
