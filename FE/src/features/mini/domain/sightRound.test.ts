import { describe, expect, it } from 'vitest';
import { STICK_PADS, type PadId } from '@/domain/kit/pads';
import {
  BAR_MAX_MS,
  BAR_MIN_MS,
  EARLY_GUARD_MS,
  HOLD_MS,
  NOTICE_MS,
  PROBLEM_LIMIT_MS,
  SCORE_STEP_MS,
  SIGHT_KICK,
  SIGHT_PROBLEMS,
  SIGHT_VARIANTS,
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  WRONG_PENALTY_MS,
  averageMs,
  barParts,
  barScaleMs,
  canAskKick,
  formatSeconds,
  isSightDetail,
  judgeHit,
  makeProblems,
  padName,
  problemMs,
  reshuffleRest,
  sightBestNote,
  sightMessage,
  sightPads,
  sightRemark,
  sightResultTitle,
  sightVariant,
  solvedCount,
  waitMs,
  wrongCount,
  type SightAnswer,
} from './sightRound';

/** 테스트용 결정적 난수(mulberry32) */
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

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);
const PADS8 = sightPads(true);
const PADS7 = sightPads(false);

function counts(list: readonly PadId[]): Map<PadId, number> {
  const map = new Map<PadId, number>();
  for (const pad of list) map.set(pad, (map.get(pad) ?? 0) + 1);
  return map;
}

function hasAdjacentDuplicate(list: readonly PadId[], before?: PadId): boolean {
  let prev = before;
  for (const pad of list) {
    if (pad === prev) return true;
    prev = pad;
  }
  return false;
}

function ans(ms: number, wrongs = 0, timedOut = false, pad: PadId = 'SNARE'): SightAnswer {
  return { pad, ms, wrongs, timedOut };
}

describe('상수', () => {
  it('설계 값과 같다', () => {
    expect(SIGHT_PROBLEMS).toBe(10);
    expect(SIGHT_KICK).toBe('KICK');
    expect(WAIT_MIN_MS).toBe(1000);
    expect(WAIT_MAX_MS).toBe(2500);
    expect(EARLY_GUARD_MS).toBe(100);
    expect(WRONG_PENALTY_MS).toBe(500);
    expect(PROBLEM_LIMIT_MS).toBe(5000);
    expect(HOLD_MS).toBe(800);
    expect(NOTICE_MS).toBe(1500);
    expect(SCORE_STEP_MS).toBe(10);
    expect(BAR_MIN_MS).toBe(1000);
    expect(BAR_MAX_MS).toBe(2000);
  });

  it('갈래는 힌트 끔, 힌트 켬 순서다', () => {
    expect(SIGHT_VARIANTS.map((v) => v.id)).toEqual(['hint-off', 'hint-on']);
    expect(SIGHT_VARIANTS.map((v) => v.name)).toEqual(['힌트 끔', '힌트 켬']);
  });
});

describe('sightVariant', () => {
  it('힌트 값을 기록 갈래로 바꾼다', () => {
    expect(sightVariant('on')).toBe('hint-on');
    expect(sightVariant('off')).toBe('hint-off');
  });
});

describe('canAskKick', () => {
  it('센서가 없으면(키보드) 페달 연결과 상관없이 참', () => {
    expect(canAskKick('none', false)).toBe(true);
    expect(canAskKick('none', true)).toBe(true);
  });

  it('동글(webserial)은 킥 페달이 연결됐을 때만 참', () => {
    expect(canAskKick('webserial', true)).toBe(true);
    expect(canAskKick('webserial', false)).toBe(false);
  });

  it('포인터·BLE는 페달 연결 표시가 있어도 거짓', () => {
    expect(canAskKick('pointer', true)).toBe(false);
    expect(canAskKick('pointer', false)).toBe(false);
    expect(canAskKick('ble', true)).toBe(false);
    expect(canAskKick('ble', false)).toBe(false);
  });
});

describe('sightPads', () => {
  it('킥을 내면 스틱 패드 7종과 킥, 모두 8종', () => {
    expect(PADS8).toHaveLength(8);
    expect(new Set(PADS8)).toEqual(new Set(['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'KICK']));
  });

  it('킥을 안 내면 스틱 패드 7종', () => {
    expect(PADS7).toHaveLength(7);
    expect(new Set(PADS7)).toEqual(new Set(['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE']));
    expect(PADS7).toEqual([...STICK_PADS]);
  });

  it('하이햇 페달은 어느 쪽에도 없다', () => {
    expect(PADS8).not.toContain('HIHAT_PEDAL');
    expect(PADS7).not.toContain('HIHAT_PEDAL');
  });
});

describe('makeProblems', () => {
  for (const [label, pads, twice] of [
    ['8종', PADS8, 2],
    ['7종', PADS7, 3],
  ] as const) {
    describe(label, () => {
      it('10문제, 모든 패드가 한 번 이상, 두 번을 넘지 않고, 이웃이 겹치지 않는다', () => {
        for (const seed of SEEDS) {
          const list = makeProblems(pads, mulberry32(seed));
          expect(list).toHaveLength(10);
          const count = counts(list);
          for (const pad of pads) expect(count.get(pad) ?? 0).toBeGreaterThanOrEqual(1);
          for (const n of count.values()) expect(n).toBeLessThanOrEqual(2);
          expect(hasAdjacentDuplicate(list)).toBe(false);
        }
      });

      it(`두 번 나오는 패드는 정확히 ${twice}개`, () => {
        for (const seed of SEEDS) {
          const list = makeProblems(pads, mulberry32(seed));
          const doubled = [...counts(list).values()].filter((n) => n === 2).length;
          expect(doubled).toBe(twice);
        }
      });

      it('첫 문제와 덤으로 두 번 나오는 패드가 판마다 달라진다', () => {
        const firsts = new Set<PadId>();
        const extras = new Set<PadId>();
        for (const seed of SEEDS) {
          const list = makeProblems(pads, mulberry32(seed));
          firsts.add(list[0]);
          for (const [pad, n] of counts(list)) if (n === 2) extras.add(pad);
        }
        expect(firsts.size).toBeGreaterThan(1);
        expect(extras.size).toBeGreaterThan(twice);
      });

      it('난수가 경계값(항상 0·0.999999·1)이어도 올바른 목록이다', () => {
        for (const value of [0, 0.999999, 1]) {
          const list = makeProblems(pads, () => value);
          expect(list).toHaveLength(10);
          const count = counts(list);
          for (const pad of pads) expect(count.get(pad) ?? 0).toBeGreaterThanOrEqual(1);
          for (const n of count.values()) expect(n).toBeLessThanOrEqual(2);
          expect(hasAdjacentDuplicate(list)).toBe(false);
        }
      });
    });
  }

  it('패드가 없으면 빈 목록', () => {
    expect(makeProblems([], mulberry32(1))).toEqual([]);
  });

  it('문제 수를 넘기면 그 수만큼 만든다(8종 8문제는 순열)', () => {
    for (const seed of SEEDS) {
      const list = makeProblems(PADS8, mulberry32(seed), 8);
      expect(list).toHaveLength(8);
      expect([...list].sort()).toEqual([...PADS8].sort());
    }
  });
});

describe('reshuffleRest', () => {
  const base: PadId[] = ['SNARE', 'KICK', 'HIHAT', 'CRASH', 'RIDE', 'MID_TOM', 'SMALL_TOM', 'FLOOR_TOM', 'SNARE', 'HIHAT'];

  it('앞 at개는 그대로, 뒤는 같은 패드들의 순열', () => {
    for (const seed of SEEDS) {
      const out = reshuffleRest(base, 3, mulberry32(seed));
      expect(out).toHaveLength(base.length);
      expect(out.slice(0, 3)).toEqual(base.slice(0, 3));
      expect([...out.slice(3)].sort()).toEqual([...base.slice(3)].sort());
    }
  });

  it('뒤 목록과 앞 경계 모두 이웃이 겹치지 않는다', () => {
    for (const seed of SEEDS) {
      for (const at of [0, 1, 3, 5]) {
        const out = reshuffleRest(base, at, mulberry32(seed));
        expect(hasAdjacentDuplicate(out.slice(at), at > 0 ? base[at - 1] : undefined)).toBe(false);
      }
    }
  });

  it('다른 패드를 첫 자리에 둘 수 있으면 지금 자리의 패드가 항상 바뀐다', () => {
    const tail: PadId[] = ['KICK', 'HIHAT', 'CRASH', 'RIDE'];
    for (const seed of SEEDS) {
      const out = reshuffleRest(['SNARE', ...tail], 1, mulberry32(seed));
      expect(out[1]).not.toBe('KICK');
      const out0 = reshuffleRest(tail, 0, mulberry32(seed));
      expect(out0[0]).not.toBe('KICK');
    }
  });

  it('남은 문제가 하나면 그대로', () => {
    expect(reshuffleRest(['SNARE', 'KICK', 'HIHAT'], 2, mulberry32(1))).toEqual(['SNARE', 'KICK', 'HIHAT']);
  });

  it('at이 0이어도 된다(앞 경계 없음)', () => {
    for (const seed of SEEDS) {
      const out = reshuffleRest(base, 0, mulberry32(seed));
      expect([...out].sort()).toEqual([...base].sort());
      expect(hasAdjacentDuplicate(out)).toBe(false);
    }
  });

  it('가능한 순서가 지금 순서뿐이면 그대로 둔다', () => {
    // 앞 문제 KICK 뒤 [SNARE, HIHAT, SNARE]는 SNARE-HIHAT-SNARE만 가능하다
    const a: PadId[] = ['KICK', 'SNARE', 'HIHAT', 'SNARE'];
    // 앞 문제 X 뒤 [A, C, A]도 마찬가지
    const b: PadId[] = ['CRASH', 'RIDE', 'KICK', 'RIDE'];
    for (const seed of SEEDS) {
      expect(reshuffleRest(a, 1, mulberry32(seed))).toEqual(a);
      expect(reshuffleRest(b, 1, mulberry32(seed))).toEqual(b);
    }
  });

  it('새 배열을 돌려주고 입력은 바꾸지 않는다', () => {
    const input = [...base];
    const out = reshuffleRest(input, 2, mulberry32(7));
    expect(out).not.toBe(input);
    expect(input).toEqual(base);
  });
});

describe('waitMs', () => {
  it('경계 난수', () => {
    expect(waitMs(() => 0)).toBe(1000);
    expect(waitMs(() => 0.999999)).toBeLessThanOrEqual(2500);
    expect(waitMs(() => 1)).toBe(2500);
  });

  it('항상 1000~2500 사이 정수', () => {
    for (const seed of SEEDS) {
      const ms = waitMs(mulberry32(seed));
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThanOrEqual(2500);
    }
  });
});

describe('judgeHit', () => {
  const t: PadId = 'SNARE';

  it('패드를 모르는 타격은 언제나 ignore', () => {
    expect(judgeHit({ pad: null, at: 500 }, t, null)).toBe('ignore');
    expect(judgeHit({ pad: null, at: 1050 }, t, 1000)).toBe('ignore');
    expect(judgeHit({ pad: null, at: 2000 }, t, 1000)).toBe('ignore');
  });

  it('제시 시각이 없으면 맞는 패드여도 early', () => {
    expect(judgeHit({ pad: t, at: 500 }, t, null)).toBe('early');
    expect(judgeHit({ pad: 'KICK', at: 500 }, t, null)).toBe('early');
  });

  it('제시 뒤 99 ms는 early', () => {
    expect(judgeHit({ pad: t, at: 1099 }, t, 1000)).toBe('early');
  });

  it('제시 뒤 100 ms부터는 맞으면 correct, 다르면 wrong', () => {
    expect(judgeHit({ pad: t, at: 1100 }, t, 1000)).toBe('correct');
    expect(judgeHit({ pad: 'KICK', at: 1100 }, t, 1000)).toBe('wrong');
  });

  it('제시 시각보다 앞선 타격은 early', () => {
    expect(judgeHit({ pad: t, at: 900 }, t, 1000)).toBe('early');
  });
});

describe('problemMs', () => {
  it('벌점이 없으면 걸린 시간', () => {
    expect(problemMs(1000, 1380, 0)).toBe(380);
  });

  it('틀릴 때마다 0.5초가 더해진다', () => {
    expect(problemMs(1000, 1380, 1)).toBe(880);
    expect(problemMs(1000, 1380, 2)).toBe(1380);
  });

  it('소수 ms는 반올림한다', () => {
    expect(problemMs(1000, 1379.6, 0)).toBe(380);
  });

  it('5000을 넘지 않는다', () => {
    expect(problemMs(0, 4800, 1)).toBe(5000);
    expect(problemMs(0, 9000, 0)).toBe(5000);
  });

  it('음수가 되지 않는다', () => {
    expect(problemMs(1000, 900, 0)).toBe(0);
  });
});

describe('averageMs', () => {
  it('평균을 10 ms 단위로 반올림한다', () => {
    expect(averageMs([{ ms: 380 }, { ms: 441 }, { ms: 502 }])).toBe(440);
  });

  it('5 ms 경계는 올린다', () => {
    expect(averageMs([{ ms: 440 }, { ms: 450 }])).toBe(450);
  });

  it('비어 있으면 0', () => {
    expect(averageMs([])).toBe(0);
  });

  it('시간 초과 문제(5000)도 평균에 든다', () => {
    expect(averageMs([{ ms: 400 }, { ms: 5000 }])).toBe(2700);
  });
});

describe('formatSeconds', () => {
  it('초 소수 둘째 자리', () => {
    expect(formatSeconds(420)).toBe('0.42');
    expect(formatSeconds(0)).toBe('0.00');
    expect(formatSeconds(5000)).toBe('5.00');
    expect(formatSeconds(1230)).toBe('1.23');
  });
});

describe('solvedCount·wrongCount', () => {
  const list = [ans(300, 1), ans(5000, 2, true), ans(400, 0)];

  it('시간 초과가 아닌 문제 수', () => {
    expect(solvedCount(list)).toBe(2);
    expect(solvedCount([])).toBe(0);
  });

  it('틀린 타격의 합', () => {
    expect(wrongCount(list)).toBe(3);
    expect(wrongCount([])).toBe(0);
  });
});

describe('sightRemark', () => {
  it('시간 초과가 있으면 그것을 말한다(틀림보다 먼저)', () => {
    expect(sightRemark([ans(5000, 2, true), ans(5000, 0, true), ans(300, 3)])).toBe('2문제는 시간이 다 됐어요.');
  });

  it('틀린 타격만 있으면 그 총 횟수', () => {
    expect(sightRemark([ans(800, 1), ans(900, 2), ans(300)])).toBe('3번 틀렸어요.');
  });

  it('둘 다 없으면 한 번도 안 틀렸어요', () => {
    expect(sightRemark([ans(300), ans(400)])).toBe('한 번도 안 틀렸어요.');
  });
});

describe('sightResultTitle', () => {
  it('평균 첫 줄과 한 줄 평', () => {
    expect(sightResultTitle([ans(441), ans(500)])).toEqual(['평균 0.47초.', '한 번도 안 틀렸어요.']);
  });

  it('한 문제도 못 맞혔으면 확인 안내', () => {
    expect(sightResultTitle([ans(5000, 0, true), ans(5000, 1, true)])).toEqual(['한 문제도 못 맞혔어요.', '스틱 연결과 패드 위치를 확인해 보세요.']);
  });
});

describe('sightBestNote', () => {
  it('이전 기록이 없으면 첫 기록', () => {
    expect(sightBestNote(470, null)).toEqual({ newBest: true, text: '첫 기록이에요' });
  });

  it('더 낮으면 새 최고와 지난 최고', () => {
    expect(sightBestNote(470, 520)).toEqual({ newBest: true, text: '지난 최고 0.52초' });
  });

  it('같으면 새 최고가 아니다', () => {
    expect(sightBestNote(470, 470)).toEqual({ newBest: false, text: '최고 기록과 같아요' });
  });

  it('더 높으면 최고까지 모자란 차이를 말한다', () => {
    expect(sightBestNote(470, 420)).toEqual({ newBest: false, text: '최고 기록 0.42초까지 0.05초' });
  });
});

describe('barScaleMs', () => {
  it('가장 긴 문제 시간을 1000~2000 안으로 자른다', () => {
    expect(barScaleMs([ans(600), ans(300)])).toBe(1000);
    expect(barScaleMs([ans(1500)])).toBe(1500);
    expect(barScaleMs([ans(5000, 0, true)])).toBe(2000);
    expect(barScaleMs([])).toBe(1000);
  });
});

describe('barParts', () => {
  it('벌점이 없으면 전부 base', () => {
    const p = barParts({ ms: 400, wrongs: 0 }, 1000);
    expect(p.base).toBeCloseTo(0.4);
    expect(p.penalty).toBe(0);
  });

  it('틀림 한 번이면 0.5초가 penalty', () => {
    const p = barParts({ ms: 880, wrongs: 1 }, 1000);
    expect(p.base).toBeCloseTo(0.38);
    expect(p.penalty).toBeCloseTo(0.5);
  });

  it('눈금을 넘으면 끝까지 채우고 합이 1을 넘지 않는다', () => {
    const p = barParts({ ms: 5000, wrongs: 1 }, 2000);
    expect(p.base).toBeCloseTo(1);
    expect(p.penalty).toBeCloseTo(0);
    const q = barParts({ ms: 1900, wrongs: 2 }, 2000);
    expect(q.base).toBeCloseTo(0.45);
    expect(q.penalty).toBeCloseTo(0.5);
    expect(q.base + q.penalty).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('벌점이 문제 시간보다 크면 문제 시간으로 자른다', () => {
    const p = barParts({ ms: 300, wrongs: 1 }, 1000);
    expect(p.base).toBeCloseTo(0);
    expect(p.penalty).toBeCloseTo(0.3);
  });

  it('눈금이 0이면 둘 다 0', () => {
    expect(barParts({ ms: 400, wrongs: 1 }, 0)).toEqual({ base: 0, penalty: 0 });
  });
});

describe('padName', () => {
  it('패드 이름', () => {
    expect(padName('SNARE')).toBe('스네어');
    expect(padName('KICK')).toBe('킥');
  });
});

describe('sightMessage', () => {
  it('대기', () => {
    expect(sightMessage('wait', null, null)).toEqual({ text: '음표가 뜨면 바로 치세요.', tone: 'plain' });
    expect(sightMessage('wait', 'early', null)).toEqual({ text: '아직이에요. 음표가 뜬 뒤에 치세요.', tone: 'bad' });
  });

  it('제시', () => {
    expect(sightMessage('shown', null, null)).toEqual({ text: '이 음표의 패드를 치세요.', tone: 'plain' });
    expect(sightMessage('shown', 'wrong', null)).toEqual({ text: '틀렸어요. 0.5초가 더해졌어요.', tone: 'bad' });
    expect(sightMessage('shown', 'early', null)).toEqual({ text: '이 음표의 패드를 치세요.', tone: 'plain' });
  });

  it('확인: 맞힘', () => {
    expect(sightMessage('hold', null, { pad: 'SNARE', timedOut: false })).toEqual({ text: '스네어, 맞았어요.', tone: 'good' });
  });

  it('확인: 시간 초과는 패드 이름 받침에 따라 조사가 바뀐다', () => {
    expect(sightMessage('hold', null, { pad: 'SNARE', timedOut: true })).toEqual({ text: '시간이 다 됐어요. 스네어였어요.', tone: 'bad' });
    expect(sightMessage('hold', null, { pad: 'KICK', timedOut: true }).text).toBe('시간이 다 됐어요. 킥이었어요.');
    expect(sightMessage('hold', null, { pad: 'HIHAT', timedOut: true }).text).toBe('시간이 다 됐어요. 하이햇이었어요.');
    expect(sightMessage('hold', null, { pad: 'RIDE', timedOut: true }).text).toBe('시간이 다 됐어요. 라이드였어요.');
    expect(sightMessage('hold', null, { pad: 'KICK', timedOut: true }).tone).toBe('bad');
  });

  it('확인인데 방금 문제가 없으면 대기 문구', () => {
    expect(sightMessage('hold', null, null)).toEqual({ text: '음표가 뜨면 바로 치세요.', tone: 'plain' });
  });
});

describe('isSightDetail', () => {
  const one = { pad: 'SNARE', ms: 400, wrongs: 0, timedOut: false };
  const ten = () => Array.from({ length: 10 }, () => ({ ...one }));

  it('10문제면 참', () => {
    expect(isSightDetail({ problems: ten() })).toBe(true);
  });

  it('문제 수가 10이 아니면 거짓', () => {
    expect(isSightDetail({ problems: ten().slice(0, 9) })).toBe(false);
    expect(isSightDetail({ problems: [...ten(), { ...one }] })).toBe(false);
  });

  it('problems가 없거나 배열이 아니거나 null이면 거짓', () => {
    expect(isSightDetail({})).toBe(false);
    expect(isSightDetail({ problems: 'x' })).toBe(false);
    expect(isSightDetail(null)).toBe(false);
    expect(isSightDetail(undefined)).toBe(false);
  });

  it('문제 하나가 잘못되면 거짓', () => {
    const bad = (patch: Record<string, unknown>) => {
      const list: unknown[] = ten();
      list[3] = { ...one, ...patch };
      return isSightDetail({ problems: list });
    };
    expect(bad({ pad: 'GHOST' })).toBe(false);
    expect(bad({ ms: -1 })).toBe(false);
    expect(bad({ ms: 5001 })).toBe(false);
    expect(bad({ ms: 3.5 })).toBe(false);
    expect(bad({ ms: '400' })).toBe(false);
    expect(bad({ wrongs: -1 })).toBe(false);
    expect(bad({ wrongs: 1.5 })).toBe(false);
    expect(bad({ timedOut: 0 })).toBe(false);
  });

  it('HIHAT_PEDAL도 PadId라 참', () => {
    const list: unknown[] = ten();
    list[0] = { ...one, pad: 'HIHAT_PEDAL' };
    expect(isSightDetail({ problems: list })).toBe(true);
  });
});
