import { describe, expect, it } from 'vitest';
import {
  bestNote,
  collectFeel,
  collectMatch,
  DYNAMICS_CLOSING_MS,
  DYNAMICS_SHOTS,
  dynamicsStep,
  feelPrompt,
  feelRange,
  FEEL_ORDER,
  formatDynamicsScore,
  isDynamicsDetail,
  labeledMarks,
  LEVEL_LABEL,
  makeMatchTargets,
  MARK_LABEL_GAP,
  MATCH_PROMPT_TAIL,
  matchScore,
  NEAR_DIFF,
  roundRemark,
  shotRemark,
  worstShot,
} from './dynamicsRound';

const START = 5000;

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

/** 타격. 타격 시각과 받은 시각이 같고 센서 소스인 스네어가 기본이다 */
function hit(t: number, velocity = 64, over: { pad?: string | null; source?: string | undefined; tRecv?: number; tHit?: number } = {}) {
  const base = { pad: 'SNARE', source: 'serial', tHit: t, tRecv: t, velocity };
  return { ...base, ...over } as unknown as Parameters<typeof collectFeel>[1][number];
}

describe('상수', () => {
  it('값이 설계와 같다', () => {
    expect(DYNAMICS_SHOTS).toBe(3);
    expect(NEAR_DIFF).toBe(12);
    expect(DYNAMICS_CLOSING_MS).toBe(1200);
  });

  it('감 잡기는 약 → 중 → 강 차례다', () => {
    expect(FEEL_ORDER).toEqual(['weak', 'mid', 'strong']);
  });
});

describe('collectFeel', () => {
  it('스네어 세 번이면 약·중·강 차례에 붙는다', () => {
    const shots = collectFeel(START, [hit(START + 300, 42), hit(START + 700, 78), hit(START + 1200, 109)]);
    expect(shots).toEqual([
      { level: 'weak', actual: 42 },
      { level: 'mid', actual: 78 },
      { level: 'strong', actual: 109 },
    ]);
  });

  it('세 타까지만 받는다', () => {
    const shots = collectFeel(START, [hit(START + 300, 42), hit(START + 700, 78), hit(START + 1200, 109), hit(START + 2000, 64)]);
    expect(shots.map((s) => s.actual)).toEqual([42, 78, 109]);
  });

  it('시작 전 타격과 시작+299 타격은 버리고 +300부터 받는다', () => {
    const shots = collectFeel(START, [hit(START - 100, 90), hit(START + 299, 91), hit(START + 300, 92)]);
    expect(shots.map((s) => s.actual)).toEqual([92]);
  });

  it('받은 타격 뒤 299ms 안의 타격은 버리고 300ms 뒤의 것은 받는다', () => {
    const shots = collectFeel(START, [hit(START + 400, 40), hit(START + 699, 11), hit(START + 700, 70)]);
    expect(shots.map((s) => s.actual)).toEqual([40, 70]);
  });

  it('다른 패드·키보드·패드 없음 타격은 차례도 기준 시각도 바꾸지 않는다', () => {
    const shots = collectFeel(START, [
      hit(START + 400, 40),
      hit(START + 500, 1, { pad: 'HIHAT' }),
      hit(START + 600, 2, { source: 'keyboard' }),
      hit(START + 650, 3, { pad: null }),
      // 위 타격들이 기준을 옮겼다면 받지 못할 시각(첫 타격 +300 = 700)
      hit(START + 700, 70),
    ]);
    expect(shots).toEqual([
      { level: 'weak', actual: 40 },
      { level: 'mid', actual: 70 },
    ]);
  });

  it('세기는 1~127 정수로 맞춘다', () => {
    const shots = collectFeel(START, [hit(START + 300, 0), hit(START + 700, 63.6), hit(START + 1200, 200)]);
    expect(shots.map((s) => s.actual)).toEqual([1, 64, 127]);
  });

  it('타격이 없으면 빈 배열', () => {
    expect(collectFeel(START, [])).toEqual([]);
  });
});

describe('collectMatch', () => {
  const TARGETS = [88, 60, 100];

  it('스네어 세 번이면 목표 순서대로 세 타가 되고 차이는 실제 − 목표다', () => {
    const shots = collectMatch(START, [hit(START + 300, 82), hit(START + 700, 69), hit(START + 1200, 100)], TARGETS);
    expect(shots).toEqual([
      { target: 88, actual: 82, diff: -6 },
      { target: 60, actual: 69, diff: 9 },
      { target: 100, actual: 100, diff: 0 },
    ]);
  });

  it('2단계 시작보다 이른 타격(감 잡기의 타격, 사이의 타격)은 타수가 되지 않는다', () => {
    const matchAt = START + 4000;
    const shots = collectMatch(
      matchAt,
      [
        // 감 잡기의 타격
        hit(START + 300, 42),
        hit(START + 700, 78),
        hit(START + 1200, 109),
        // 감 잡기와 2단계 사이에 친 타격
        hit(matchAt - 1000, 55),
        hit(matchAt - 1, 56),
        // 2단계의 첫 타
        hit(matchAt + 300, 90),
      ],
      TARGETS,
    );
    expect(shots).toEqual([{ target: 88, actual: 90, diff: 2 }]);
  });

  it('2단계 시작 뒤 299ms는 버리고 300ms부터 받는다', () => {
    expect(collectMatch(START, [hit(START + 299, 90)], TARGETS)).toEqual([]);
    expect(collectMatch(START, [hit(START + 300, 90)], TARGETS)).toHaveLength(1);
  });

  it('목표 수까지만 받는다', () => {
    const shots = collectMatch(
      START,
      [hit(START + 300, 80), hit(START + 700, 60), hit(START + 1200, 100), hit(START + 2000, 64)],
      TARGETS,
    );
    expect(shots.map((s) => s.actual)).toEqual([80, 60, 100]);
  });

  it('다른 패드·키보드 타격은 받지 않는다', () => {
    const shots = collectMatch(
      START,
      [hit(START + 400, 1, { pad: 'HIHAT' }), hit(START + 500, 2, { source: 'keyboard' }), hit(START + 700, 85)],
      TARGETS,
    );
    expect(shots).toEqual([{ target: 88, actual: 85, diff: -3 }]);
  });

  it('목표가 비어 있으면 빈 배열', () => {
    expect(collectMatch(START, [hit(START + 300, 80)], [])).toEqual([]);
  });
});

describe('dynamicsStep', () => {
  it('감 잡기 0·1·2타면 feel', () => {
    for (const count of [0, 1, 2]) expect(dynamicsStep(count, null)).toBe('feel');
  });

  it('3타이고 2단계 시작 시각이 없으면 review', () => {
    expect(dynamicsStep(3, null)).toBe('review');
  });

  it('3타이고 2단계 시작 시각이 있으면 match', () => {
    expect(dynamicsStep(3, START)).toBe('match');
  });
});

describe('feelRange', () => {
  it('범위 안이고 폭이 넉넉하면 그대로다(42·78·109 → 42~109)', () => {
    expect(feelRange([42, 78, 109])).toEqual({ low: 42, high: 109 });
  });

  it('20 아래와 120 위는 잘린다', () => {
    expect(feelRange([5, 60, 127])).toEqual({ low: 20, high: 120 });
  });

  it('폭이 45보다 좁으면 가운데를 지키며 넓힌다(60·65·70 → 42.5~87.5)', () => {
    expect(feelRange([60, 65, 70])).toEqual({ low: 42.5, high: 87.5 });
  });

  it('넓히다 20 아래로 나가면 위로 민다(20·22·25 → 20~65)', () => {
    expect(feelRange([20, 22, 25])).toEqual({ low: 20, high: 65 });
  });

  it('넓히다 120 위로 나가면 아래로 민다(118·119·120 → 75~120)', () => {
    expect(feelRange([118, 119, 120])).toEqual({ low: 75, high: 120 });
  });

  it('세 값이 같아도 폭은 45다', () => {
    expect(feelRange([60, 60, 60])).toEqual({ low: 37.5, high: 82.5 });
  });

  it('폭이 정확히 45면 넓히지 않는다', () => {
    expect(feelRange([50, 60, 95])).toEqual({ low: 50, high: 95 });
  });

  it('값이 없으면 20~120 전체다', () => {
    expect(feelRange([])).toEqual({ low: 20, high: 120 });
  });

  it('값의 순서와 무관하게 최소·최대로 잡는다(약이 중보다 세도 된다)', () => {
    expect(feelRange([100, 50, 80])).toEqual({ low: 50, high: 100 });
    expect(feelRange([109, 78, 42])).toEqual({ low: 42, high: 109 });
  });
});

describe('makeMatchTargets', () => {
  const FEEL = [42, 78, 109];

  it('목표가 3개 정수다', () => {
    const targets = makeMatchTargets(FEEL, mulberry32(7));
    expect(targets).toHaveLength(3);
    for (const t of targets) expect(Number.isInteger(t)).toBe(true);
  });

  it('내 세기 42·78·109면 정렬했을 때 47~59, 69~82, 92~104 안에 하나씩이다(시드 400개)', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const [a, b, c] = makeMatchTargets(FEEL, mulberry32(seed)).sort((x, y) => x - y);
      expect(a).toBeGreaterThanOrEqual(47);
      expect(a).toBeLessThanOrEqual(59);
      expect(b).toBeGreaterThanOrEqual(69);
      expect(b).toBeLessThanOrEqual(82);
      expect(c).toBeGreaterThanOrEqual(92);
      expect(c).toBeLessThanOrEqual(104);
    }
  });

  it('어떤 입력이든 세 목표가 범위 안이고 20~120 안이다', () => {
    const inputs = [
      [42, 78, 109],
      [60, 65, 70],
      [20, 22, 25],
      [118, 119, 120],
      [5, 60, 127],
      [1, 1, 1],
      [127, 127, 127],
      [100, 127, 127],
      [],
    ];
    for (const values of inputs) {
      const { low, high } = feelRange(values);
      for (let seed = 1; seed <= 200; seed += 1) {
        const targets = makeMatchTargets(values, mulberry32(seed));
        expect(targets).toHaveLength(3);
        for (const t of targets) {
          expect(t).toBeGreaterThanOrEqual(low);
          expect(t).toBeLessThanOrEqual(high);
          expect(t).toBeGreaterThanOrEqual(20);
          expect(t).toBeLessThanOrEqual(120);
        }
      }
    }
  });

  it('최소 폭 45일 때도 정렬한 이웃 목표의 차이가 6 이상이다', () => {
    for (const values of [[60, 60, 60], [60, 65, 70], [20, 20, 20], [120, 120, 120], [20, 22, 25], [118, 119, 120]]) {
      for (let seed = 1; seed <= 300; seed += 1) {
        const sorted = makeMatchTargets(values, mulberry32(seed)).sort((x, y) => x - y);
        expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(6);
        expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('난수가 늘 0이면 각 구간의 아래 끝이 나오고 순서 섞기까지 거친다', () => {
    // 아래 끝: [47, 69, 92]. 섞기: i=2 → j=0이라 0·2 맞바꿈 → [92, 69, 47]. i=1 → j=0이라 0·1 맞바꿈 → [69, 92, 47]
    expect(makeMatchTargets(FEEL, () => 0)).toEqual([69, 92, 47]);
  });

  it('난수가 늘 0.999999면 각 구간의 위 끝이 나온다', () => {
    // 위 끝: [59, 82, 104]. 섞기: i=2 → j=2, i=1 → j=1이라 그대로
    expect(makeMatchTargets(FEEL, () => 0.999999)).toEqual([59, 82, 104]);
  });

  it('난수가 1을 내도 범위를 넘지 않는다', () => {
    expect(makeMatchTargets(FEEL, () => 1)).toEqual([59, 82, 104]);
  });

  it('순서가 섞인다(오름차순이 아닌 판이 나온다)', () => {
    let unsorted = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const targets = makeMatchTargets(FEEL, mulberry32(seed));
      if (targets.some((t, i) => i > 0 && t < targets[i - 1])) unsorted += 1;
    }
    expect(unsorted).toBeGreaterThan(0);
  });
});

describe('matchScore', () => {
  it('차이 6·−9·2는 17', () => {
    expect(matchScore([{ diff: 6 }, { diff: -9 }, { diff: 2 }])).toBe(17);
  });

  it('친 것이 없으면 0', () => {
    expect(matchScore([])).toBe(0);
  });

  it('모두 0이면 0', () => {
    expect(matchScore([{ diff: 0 }, { diff: 0 }, { diff: 0 }])).toBe(0);
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
    expect(roundRemark([{ diff: 0 }, { diff: 0 }, { diff: 0 }])).toBe('세 번 모두 딱 맞았어요.');
  });

  it('가장 큰 차이가 12 이하면 그 타의 차례와 방향을 「조금」으로 말한다', () => {
    expect(roundRemark([{ diff: 2 }, { diff: 9 }, { diff: -3 }])).toBe('2타가 조금 셌어요.');
  });

  it('가장 큰 차이가 12보다 크면 「많이」로 말한다', () => {
    expect(roundRemark([{ diff: 2 }, { diff: 3 }, { diff: -20 }])).toBe('3타가 많이 약했어요.');
  });

  it('차이 12는 조금, 13은 많이', () => {
    expect(roundRemark([{ diff: 12 }])).toBe('1타가 조금 셌어요.');
    expect(roundRemark([{ diff: -12 }])).toBe('1타가 조금 약했어요.');
    expect(roundRemark([{ diff: 13 }])).toBe('1타가 많이 셌어요.');
    expect(roundRemark([{ diff: -13 }])).toBe('1타가 많이 약했어요.');
  });

  it('차이가 같으면 먼저 친 타를 말한다', () => {
    expect(roundRemark([{ diff: 1 }, { diff: -6 }, { diff: 6 }])).toBe('2타가 조금 약했어요.');
  });

  it('차이가 음수면 약했어요', () => {
    expect(roundRemark([{ diff: -6 }, { diff: 1 }, { diff: 0 }])).toBe('1타가 조금 약했어요.');
  });
});

describe('feelPrompt·LEVEL_LABEL·MATCH_PROMPT_TAIL', () => {
  it('감 잡기 머리 문구', () => {
    expect(feelPrompt('weak')).toBe('약하게 한 번.');
    expect(feelPrompt('mid')).toBe('중간으로 한 번.');
    expect(feelPrompt('strong')).toBe('강하게 한 번.');
  });

  it('숫자 맞추기 머리 문구의 숫자 뒤 글', () => {
    expect(MATCH_PROMPT_TAIL).toBe('에 맞춰 한 번.');
  });

  it('단계 글자', () => {
    expect(LEVEL_LABEL).toEqual({ weak: '약', mid: '중', strong: '강' });
  });
});

describe('formatDynamicsScore', () => {
  it('앞에 「오차」를 붙인다', () => {
    expect(formatDynamicsScore(14)).toBe('오차 14');
    expect(formatDynamicsScore(0)).toBe('오차 0');
  });
});

describe('labeledMarks', () => {
  const feel = (weak: number, mid: number, strong: number) => [
    { level: 'weak' as const, actual: weak },
    { level: 'mid' as const, actual: mid },
    { level: 'strong' as const, actual: strong },
  ];

  it('세 값이 충분히 떨어져 있으면 셋 다 글자를 단다', () => {
    expect(labeledMarks(feel(42, 78, 109))).toEqual(['weak', 'mid', 'strong']);
  });

  it('앞서 글자를 단 값과 12 미만으로 붙은 값은 글자를 달지 않는다', () => {
    // 60에 글자, 64·68은 60에서 12 미만
    expect(labeledMarks(feel(60, 64, 68))).toEqual(['weak']);
  });

  it('경계: 정확히 12 떨어지면 달고 11이면 달지 않는다', () => {
    expect(MARK_LABEL_GAP).toBe(12);
    expect(labeledMarks(feel(50, 62, 100))).toEqual(['weak', 'mid', 'strong']);
    expect(labeledMarks(feel(50, 61, 100))).toEqual(['weak', 'strong']);
  });

  it('거리는 글자를 단 마지막 값에서 잰다(건너뛴 값에서 재지 않는다)', () => {
    // 50에 글자, 58은 건너뛰고, 66은 50에서 16 떨어져 단다
    expect(labeledMarks(feel(50, 58, 66))).toEqual(['weak', 'strong']);
  });

  it('이름이 아니라 값이 낮은 것부터 본다(약을 가장 세게 쳤어도)', () => {
    // 값 순서: 강 40 → 중 45 → 약 110
    expect(labeledMarks(feel(110, 45, 40))).toEqual(['strong', 'weak']);
  });

  it('비어 있으면 빈 배열', () => {
    expect(labeledMarks([])).toEqual([]);
  });
});

describe('bestNote (낮을수록 좋다)', () => {
  it('이전 기록이 없으면 첫 기록', () => {
    expect(bestNote(14, null)).toEqual({ newBest: true, text: '첫 기록이에요' });
  });

  it('이전보다 낮으면 새 최고', () => {
    expect(bestNote(14, 21)).toEqual({ newBest: true, text: '지난 최고 오차 21' });
  });

  it('같으면 새 최고가 아니다', () => {
    expect(bestNote(14, 14)).toEqual({ newBest: false, text: '최고 기록과 같아요' });
  });

  it('이전보다 높으면 최고 기록을 알려 준다', () => {
    expect(bestNote(14, 9)).toEqual({ newBest: false, text: '최고 기록 오차 9' });
  });
});

describe('isDynamicsDetail', () => {
  const shot = (over: Record<string, unknown> = {}) => ({ target: 80, actual: 86, ...over });
  const shots3 = () => [shot(), shot({ target: 50, actual: 44 }), shot({ target: 100, actual: 127 })];
  const detail = (over: Record<string, unknown> = {}) => ({ feel: [42, 78, 109], shots: shots3(), ...over });

  it('새 모양이면 참', () => {
    expect(isDynamicsDetail(detail())).toBe(true);
  });

  it('예전 모양(feel 없이 level이 든 shots)은 거짓', () => {
    const legacy = {
      shots: [
        { level: 'weak', target: 40, actual: 46 },
        { level: 'mid', target: 80, actual: 82 },
        { level: 'strong', target: 110, actual: 104 },
      ],
    };
    expect(isDynamicsDetail(legacy)).toBe(false);
  });

  it('feel이 2개·4개면 거짓', () => {
    expect(isDynamicsDetail(detail({ feel: [42, 78] }))).toBe(false);
    expect(isDynamicsDetail(detail({ feel: [42, 78, 100, 109] }))).toBe(false);
  });

  it('feel에 정수가 아니거나 눈금 밖(0·128)이거나 숫자가 아닌 값이 있으면 거짓', () => {
    expect(isDynamicsDetail(detail({ feel: [42, 78.5, 109] }))).toBe(false);
    expect(isDynamicsDetail(detail({ feel: [0, 78, 109] }))).toBe(false);
    expect(isDynamicsDetail(detail({ feel: [42, 78, 128] }))).toBe(false);
    expect(isDynamicsDetail(detail({ feel: ['42', 78, 109] }))).toBe(false);
  });

  it('feel이 배열이 아니면 거짓', () => {
    expect(isDynamicsDetail(detail({ feel: '42,78,109' }))).toBe(false);
    expect(isDynamicsDetail({ shots: shots3() })).toBe(false);
  });

  it('shots가 2개·4개면 거짓', () => {
    expect(isDynamicsDetail(detail({ shots: [shot(), shot()] }))).toBe(false);
    expect(isDynamicsDetail(detail({ shots: [shot(), shot(), shot(), shot()] }))).toBe(false);
  });

  it('shots의 target·actual이 눈금 밖·정수 아님·문자열이면 거짓', () => {
    const three = (bad: Record<string, unknown>) => detail({ shots: [shot(), shot(), shot(bad)] });
    expect(isDynamicsDetail(three({ target: 0 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 0 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: 128 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 128 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: 3.5 }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: 3.5 }))).toBe(false);
    expect(isDynamicsDetail(three({ target: '80' }))).toBe(false);
    expect(isDynamicsDetail(three({ actual: '86' }))).toBe(false);
  });

  it('shots가 배열이 아니거나 타 하나가 객체가 아니면 거짓', () => {
    expect(isDynamicsDetail(detail({ shots: 'abc' }))).toBe(false);
    expect(isDynamicsDetail(detail({ shots: { length: 3 } }))).toBe(false);
    expect(isDynamicsDetail(detail({ shots: [shot(), shot(), null] }))).toBe(false);
  });

  it('null·undefined·문자열·배열은 거짓', () => {
    expect(isDynamicsDetail(null)).toBe(false);
    expect(isDynamicsDetail(undefined)).toBe(false);
    expect(isDynamicsDetail('x')).toBe(false);
    expect(isDynamicsDetail([])).toBe(false);
    expect(isDynamicsDetail({})).toBe(false);
  });
});
