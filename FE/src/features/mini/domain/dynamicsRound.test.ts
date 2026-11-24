import { describe, expect, it } from 'vitest';
import {
  acceptsShot,
  bandRange,
  bestNote,
  canStartDynamics,
  collectShots,
  DYNAMICS_CLOSING_MS,
  DYNAMICS_PAD,
  DYNAMICS_SHOTS,
  DYNAMICS_TARGETS,
  isDynamicsDetail,
  isWrongPad,
  LEVEL_LABEL,
  levelPrompt,
  makeTargets,
  roundRemark,
  roundScore,
  SHOT_GUARD_MS,
  shotRemark,
  shotScore,
  TARGET_BAND,
  toShot,
  velocityRatio,
  VELOCITY_MAX,
  VELOCITY_MIN,
  WRONG_PAD_HINT_MS,
  worstShot,
  type DynamicsLevel,
  type DynamicsTarget,
} from './dynamicsRound';

const START = 5000;
const LEVELS: DynamicsLevel[] = ['weak', 'mid', 'strong'];

/** 시드 고정 난수(mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 정해 둔 숫자를 차례로 돌려주는 난수 */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

/** 타격. 타격 시각과 받은 시각이 같고 센서 소스인 스네어가 기본이다 */
function hit(t: number, velocity = 64, over: { pad?: string | null; source?: string | undefined; tRecv?: number; tHit?: number } = {}) {
  const base = { pad: 'SNARE', source: 'serial', tHit: t, tRecv: t, velocity };
  return { ...base, ...over } as unknown as Parameters<typeof collectShots>[1][number];
}

function acc(h: unknown, since: number): boolean {
  return acceptsShot(h as Parameters<typeof acceptsShot>[0], since);
}

const TARGETS: DynamicsTarget[] = [
  { level: 'strong', velocity: 110 },
  { level: 'weak', velocity: 40 },
  { level: 'mid', velocity: 80 },
];

describe('상수', () => {
  it('값이 설계와 같다', () => {
    expect(DYNAMICS_SHOTS).toBe(3);
    expect(DYNAMICS_PAD).toBe('SNARE');
    expect(VELOCITY_MIN).toBe(1);
    expect(VELOCITY_MAX).toBe(127);
    expect(TARGET_BAND).toBe(12);
    expect(SHOT_GUARD_MS).toBe(300);
    expect(DYNAMICS_CLOSING_MS).toBe(1200);
    expect(WRONG_PAD_HINT_MS).toBe(1500);
  });

  it('단계별 목표 후보가 설계와 같다', () => {
    expect(DYNAMICS_TARGETS.weak).toEqual([35, 40, 45, 50, 55]);
    expect(DYNAMICS_TARGETS.mid).toEqual([70, 75, 80, 85]);
    expect(DYNAMICS_TARGETS.strong).toEqual([100, 105, 110, 115]);
  });

  it('모든 후보의 띠(±12)가 눈금 1~127 안이다', () => {
    for (const level of LEVELS) {
      for (const v of DYNAMICS_TARGETS[level]) {
        expect(v - TARGET_BAND).toBeGreaterThanOrEqual(VELOCITY_MIN);
        expect(v + TARGET_BAND).toBeLessThanOrEqual(VELOCITY_MAX);
      }
    }
  });

  it('이웃한 단계의 후보끼리 15 이상 떨어져 있다', () => {
    const gap = (lower: readonly number[], upper: readonly number[]) => Math.min(...upper) - Math.max(...lower);
    expect(gap(DYNAMICS_TARGETS.weak, DYNAMICS_TARGETS.mid)).toBeGreaterThanOrEqual(15);
    expect(gap(DYNAMICS_TARGETS.mid, DYNAMICS_TARGETS.strong)).toBeGreaterThanOrEqual(15);
  });
});

describe('makeTargets', () => {
  it('강·약·중이 한 번씩이고 값은 그 단계의 후보다(시드 500개)', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const targets = makeTargets(mulberry32(seed));
      expect(targets).toHaveLength(3);
      expect(targets.map((t) => t.level).sort()).toEqual(['mid', 'strong', 'weak']);
      for (const t of targets) expect(DYNAMICS_TARGETS[t.level]).toContain(t.velocity);
    }
  });

  it('여러 판에 걸쳐 여섯 순서와 모든 후보가 나온다', () => {
    const orders = new Set<string>();
    const seen: Record<DynamicsLevel, Set<number>> = { weak: new Set(), mid: new Set(), strong: new Set() };
    for (let seed = 1; seed <= 500; seed += 1) {
      const targets = makeTargets(mulberry32(seed));
      orders.add(targets.map((t) => t.level).join('>'));
      for (const t of targets) seen[t.level].add(t.velocity);
    }
    expect(orders.size).toBe(6);
    for (const level of LEVELS) expect([...seen[level]].sort((a, b) => a - b)).toEqual([...DYNAMICS_TARGETS[level]]);
  });

  it('정해 둔 난수열이면 결과도 정해진다(섞기 두 번 → 뽑기 세 번)', () => {
    // 시작 [강,약,중]. i=2: floor(0.5*3)=1 → 2·1 맞바꿈 → [강,중,약]. i=1: floor(0.9*2)=1 → 그대로.
    // 뽑기: 강 0.99*4=3 → 115, 중 0.5*4=2 → 80, 약 0*5=0 → 35
    expect(makeTargets(sequence([0.5, 0.9, 0.99, 0.5, 0]))).toEqual([
      { level: 'strong', velocity: 115 },
      { level: 'mid', velocity: 80 },
      { level: 'weak', velocity: 35 },
    ]);
  });

  it('난수가 늘 0이면 [약,중,강]의 첫 후보', () => {
    // i=2: j=0 → [중,약,강]. i=1: j=0 → [약,중,강]
    expect(makeTargets(() => 0)).toEqual([
      { level: 'weak', velocity: 35 },
      { level: 'mid', velocity: 70 },
      { level: 'strong', velocity: 100 },
    ]);
  });

  it('난수가 늘 0.999999여도 유효한 목표다', () => {
    const targets = makeTargets(() => 0.999999);
    expect(targets).toHaveLength(3);
    for (const t of targets) expect(DYNAMICS_TARGETS[t.level]).toContain(t.velocity);
  });

  it('난수가 1이 들어와도 값이 비지 않는다', () => {
    const targets = makeTargets(() => 1);
    expect(targets).toHaveLength(3);
    for (const t of targets) {
      expect(t.velocity).toBeDefined();
      expect(DYNAMICS_TARGETS[t.level]).toContain(t.velocity);
    }
    expect(targets.map((t) => t.level).sort()).toEqual(['mid', 'strong', 'weak']);
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

describe('shotScore', () => {
  it('차이 0은 100점', () => {
    expect(shotScore(80, 80)).toBe(100);
  });

  it('차이 6은 94점(양방향)', () => {
    expect(shotScore(80, 86)).toBe(94);
    expect(shotScore(80, 74)).toBe(94);
  });

  it('차이 100은 0점', () => {
    expect(shotScore(110, 10)).toBe(0);
  });

  it('차이가 100을 넘어도 음수가 되지 않는다', () => {
    expect(shotScore(115, 1)).toBe(0);
  });
});

describe('toShot', () => {
  it('단계·목표·실제·차이·점수를 채운다', () => {
    expect(toShot({ level: 'mid', velocity: 80 }, 89)).toEqual({ level: 'mid', target: 80, actual: 89, diff: 9, score: 91 });
  });

  it('차이는 실제 − 목표라 셀수록 양수다', () => {
    expect(toShot({ level: 'weak', velocity: 40 }, 46).diff).toBe(6);
    expect(toShot({ level: 'weak', velocity: 40 }, 34).diff).toBe(-6);
  });

  it('실제 세기는 눈금 안 정수로 맞춘다', () => {
    const target = { level: 'strong' as const, velocity: 100 };
    expect(toShot(target, 0).actual).toBe(1);
    expect(toShot(target, 200).actual).toBe(127);
    expect(toShot(target, 103.6).actual).toBe(104);
  });
});

describe('collectShots', () => {
  it('스네어 세 번이면 목표 순서대로 세 타가 된다', () => {
    const shots = collectShots(START, [hit(START + 300, 100), hit(START + 700, 50), hit(START + 1200, 85)], TARGETS);
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.level)).toEqual(['strong', 'weak', 'mid']);
    expect(shots.map((s) => s.actual)).toEqual([100, 50, 85]);
    expect(shots.map((s) => s.diff)).toEqual([-10, 10, 5]);
  });

  it('시작 전 타격과 시작+299 타격은 버리고 +300부터 받는다', () => {
    const shots = collectShots(START, [hit(START - 100, 90), hit(START + 299, 91), hit(START + 300, 92)], TARGETS);
    expect(shots.map((s) => s.actual)).toEqual([92]);
  });

  it('받은 타격 300ms 안의 두 번째는 버리고 300ms 뒤의 것은 받는다', () => {
    const shots = collectShots(START, [hit(START + 400, 100), hit(START + 699, 11), hit(START + 700, 50)], TARGETS);
    expect(shots.map((s) => s.actual)).toEqual([100, 50]);
  });

  it('다른 패드·키보드·패드 없음 타격은 차례도 기준 시각도 바꾸지 않는다', () => {
    const shots = collectShots(
      START,
      [
        hit(START + 400, 100),
        hit(START + 500, 1, { pad: 'HIHAT' }),
        hit(START + 600, 2, { source: 'keyboard' }),
        hit(START + 650, 3, { pad: null }),
        // 위 타격들이 기준을 옮겼다면 받지 못할 시각(첫 타격 +300 = 700)
        hit(START + 700, 50),
      ],
      TARGETS,
    );
    expect(shots.map((s) => s.actual)).toEqual([100, 50]);
    expect(shots[1].level).toBe('weak');
  });

  it('목표 수만큼 받으면 네 번째는 버린다', () => {
    const shots = collectShots(
      START,
      [hit(START + 300, 100), hit(START + 700, 50), hit(START + 1200, 85), hit(START + 2000, 64)],
      TARGETS,
    );
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.actual)).toEqual([100, 50, 85]);
  });

  it('받은 순서대로 본다: 늦게 도착한 이른 시각 타격은 버리고 앞의 결과는 그대로다', () => {
    const first = collectShots(START, [hit(START + 1000, 100)], TARGETS);
    const withLate = collectShots(START, [hit(START + 1000, 100), hit(START + 400, 77)], TARGETS);
    expect(withLate).toEqual(first);
    expect(withLate).toHaveLength(1);
  });

  it('타격이 없으면 빈 배열', () => {
    expect(collectShots(START, [], TARGETS)).toEqual([]);
  });
});

describe('roundScore', () => {
  it('차이 6·9·2는 94점·91점·98점 → 평균 94.33 → 94', () => {
    const target = { level: 'mid' as const, velocity: 80 };
    const shots = [toShot(target, 86), toShot(target, 71), toShot(target, 82)];
    expect(shots.map((s) => s.score)).toEqual([94, 91, 98]);
    expect(roundScore(shots)).toBe(94);
  });

  it('평균을 반올림한다', () => {
    expect(roundScore([{ score: 100 }, { score: 100 }, { score: 99 }])).toBe(100);
    expect(roundScore([{ score: 90 }, { score: 91 }, { score: 91 }])).toBe(91);
  });

  it('.5는 올린다', () => {
    expect(roundScore([{ score: 100 }, { score: 99 }])).toBe(100);
    expect(roundScore([{ score: 90 }, { score: 91 }])).toBe(91);
  });

  it('친 것이 없으면 0', () => {
    expect(roundScore([])).toBe(0);
  });
});

describe('worstShot', () => {
  it('차이의 절댓값이 가장 큰 타를 고른다', () => {
    const shots = [{ diff: 3 }, { diff: -9 }, { diff: 5 }];
    expect(worstShot(shots)).toBe(shots[1]);
  });

  it('음수와 양수를 절댓값으로 견준다', () => {
    const shots = [{ diff: -4 }, { diff: 7 }];
    expect(worstShot(shots)).toBe(shots[1]);
  });

  it('같으면 먼저 친 타', () => {
    const shots = [{ diff: -6 }, { diff: 6 }, { diff: 2 }];
    expect(worstShot(shots)).toBe(shots[0]);
  });

  it('친 것이 없으면 null', () => {
    expect(worstShot([])).toBeNull();
  });
});

describe('shotRemark', () => {
  it('sentence 문구', () => {
    expect(shotRemark(-6, 'sentence')).toBe('6 약했어요');
    expect(shotRemark(9, 'sentence')).toBe('9 셌어요');
    expect(shotRemark(0, 'sentence')).toBe('딱 맞았어요');
  });

  it('short 문구', () => {
    expect(shotRemark(-6, 'short')).toBe('6 약함');
    expect(shotRemark(9, 'short')).toBe('9 셈');
    expect(shotRemark(0, 'short')).toBe('딱 맞음');
  });

  it('스타일을 생략하면 sentence', () => {
    expect(shotRemark(-6)).toBe('6 약했어요');
    expect(shotRemark(0)).toBe('딱 맞았어요');
  });
});

describe('roundRemark', () => {
  it('모두 딱 맞으면 그렇게 말한다', () => {
    expect(
      roundRemark([
        { level: 'weak', diff: 0 },
        { level: 'mid', diff: 0 },
        { level: 'strong', diff: 0 },
      ]),
    ).toBe('세 번 모두 딱 맞았어요.');
  });

  it('가장 어긋난 타가 약한 타격의 +9면 「약한 타격이 조금 셌어요.」', () => {
    expect(
      roundRemark([
        { level: 'strong', diff: 2 },
        { level: 'weak', diff: 9 },
        { level: 'mid', diff: -3 },
      ]),
    ).toBe('약한 타격이 조금 셌어요.');
  });

  it('차이 12는 조금, 13은 많이', () => {
    expect(roundRemark([{ level: 'mid', diff: 12 }])).toBe('중간 타격이 조금 셌어요.');
    expect(roundRemark([{ level: 'mid', diff: -12 }])).toBe('중간 타격이 조금 약했어요.');
    expect(roundRemark([{ level: 'mid', diff: 13 }])).toBe('중간 타격이 많이 셌어요.');
    expect(roundRemark([{ level: 'mid', diff: -13 }])).toBe('중간 타격이 많이 약했어요.');
  });

  it('중간 타격 −20은 많이 약했어요', () => {
    expect(roundRemark([{ level: 'mid', diff: -20 }])).toBe('중간 타격이 많이 약했어요.');
  });

  it('강한 타격 −6은 조금 약했어요', () => {
    expect(roundRemark([{ level: 'strong', diff: -6 }])).toBe('강한 타격이 조금 약했어요.');
  });
});

describe('levelPrompt·LEVEL_LABEL', () => {
  it('머리 문구', () => {
    expect(levelPrompt('weak')).toBe('이번엔 약하게.');
    expect(levelPrompt('mid')).toBe('이번엔 중간으로.');
    expect(levelPrompt('strong')).toBe('이번엔 강하게.');
  });

  it('단계 글자', () => {
    expect(LEVEL_LABEL).toEqual({ weak: '약', mid: '중', strong: '강' });
  });
});

describe('bandRange', () => {
  it('목표 ±12', () => {
    expect(bandRange(110)).toEqual({ low: 98, high: 122 });
  });

  it('눈금 밖은 자른다', () => {
    expect(bandRange(5).low).toBe(1);
    expect(bandRange(120).high).toBe(127);
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

describe('bestNote', () => {
  it('이전 기록이 없으면 첫 기록', () => {
    expect(bestNote(94, null)).toEqual({ newBest: true, text: '첫 기록이에요' });
  });

  it('이전보다 높으면 새 최고', () => {
    expect(bestNote(94, 90)).toEqual({ newBest: true, text: '지난 최고 90점' });
  });

  it('같으면 새 최고가 아니다', () => {
    expect(bestNote(94, 94)).toEqual({ newBest: false, text: '최고 기록과 같아요' });
  });

  it('낮으면 최고 기록을 알려 준다', () => {
    expect(bestNote(94, 96)).toEqual({ newBest: false, text: '최고 기록 96점' });
  });
});

describe('canStartDynamics', () => {
  const states: [boolean, boolean][] = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];

  it('센서를 고르지 않았으면 나머지와 상관없이 거짓', () => {
    for (const connected of states) {
      expect(canStartDynamics('none', false, connected)).toBe(false);
      expect(canStartDynamics('none', true, connected)).toBe(false);
    }
  });

  it('연결이 필요한 센서는 한 손 이상 연결돼야 참', () => {
    expect(canStartDynamics('serial', false, [false, false])).toBe(false);
    expect(canStartDynamics('serial', false, [true, false])).toBe(true);
    expect(canStartDynamics('serial', false, [false, true])).toBe(true);
    expect(canStartDynamics('serial', false, [true, true])).toBe(true);
  });

  it('연결 개념이 없는 소스는 연결과 상관없이 참', () => {
    for (const connected of states) expect(canStartDynamics('pointer', true, connected)).toBe(true);
  });
});

describe('isDynamicsDetail', () => {
  const shot = (over: Record<string, unknown> = {}) => ({ level: 'mid', target: 80, actual: 86, ...over });
  const detail = (shots: unknown) => ({ shots });

  it('세 타가 맞으면 참', () => {
    expect(
      isDynamicsDetail(detail([shot(), shot({ level: 'weak', target: 40, actual: 35 }), shot({ level: 'strong', target: 110, actual: 127 })])),
    ).toBe(true);
  });

  it('타 수가 3이 아니면 거짓', () => {
    expect(isDynamicsDetail(detail([shot(), shot()]))).toBe(false);
    expect(isDynamicsDetail(detail([shot(), shot(), shot(), shot()]))).toBe(false);
  });

  it('모양이 틀리면 거짓', () => {
    expect(isDynamicsDetail({})).toBe(false);
    expect(isDynamicsDetail(detail('abc'))).toBe(false);
    expect(isDynamicsDetail(detail({ length: 3 }))).toBe(false);
    expect(isDynamicsDetail(null)).toBe(false);
    expect(isDynamicsDetail(undefined)).toBe(false);
    expect(isDynamicsDetail('x')).toBe(false);
  });

  it('모르는 단계나 눈금 밖·정수 아닌·숫자 아닌 값이 있으면 거짓', () => {
    const three = (bad: Record<string, unknown>) => detail([shot(), shot(), shot(bad)]);
    expect(isDynamicsDetail(three({ level: 'loud' }))).toBe(false);
    expect(isDynamicsDetail(three({ target: 0 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 0 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: 128 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 128 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: 3.5 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 3.5 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: '80' }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: '86' }))).toBe(false);
  });

  it('타 하나가 객체가 아니면 거짓', () => {
    expect(isDynamicsDetail(detail([shot(), shot(), null]))).toBe(false);
  });
});
