import { describe, expect, it } from 'vitest';
import { LIVE_COACH_CONFIG } from './config';
import { CoachPolicy } from './policy';
import { RECOVERED_PRAISE, type RuleEvaluation } from './rules';

function ev(key: string, over: Partial<RuleEvaluation> = {}): RuleEvaluation {
  return {
    key,
    tag: 'LIVE_LATE',
    priority: 1,
    trigger: false,
    release: false,
    severity: 0.5,
    text: key,
    target: null,
    ...over,
  };
}
const on = (key: string, over: Partial<RuleEvaluation> = {}) => ev(key, { trigger: true, ...over });
const ctx = (songTimeMs: number, judged = 20) => ({ songTimeMs, judged });
const { minGapMs, tagCooldownMs } = LIVE_COACH_CONFIG.policy;
const praiseGapMs = LIVE_COACH_CONFIG.praise.minGapMs;
const keepGapMs = LIVE_COACH_CONFIG.praise.keepMinGapMs;
const good = ev('LIVE_GOOD_STEADY', { tag: 'LIVE_GOOD_STEADY', priority: 5, trigger: true });

describe('CoachPolicy 판정 단계', () => {
  const streak = () => on('LIVE_MISS_STREAK', { tag: 'LIVE_MISS_STREAK' });

  it('판정 4개 전에는 연속 놓침도 띄우지 않는다', () => {
    const p = new CoachPolicy();
    const d = p.decide([streak()], ctx(5_000, 3));
    expect(d.show).toBeNull();
    expect(d.stage).toBe(0);
  });

  it('1단계(4~7개)는 연속 놓침만 띄운다', () => {
    const p = new CoachPolicy();
    const late = p.decide([on('A')], ctx(5_000, 4));
    expect(late.show).toBeNull();
    expect(late.stage).toBe(1);
    expect(p.decide([on('A'), streak()], ctx(5_000, 4)).show?.key).toBe('LIVE_MISS_STREAK');
  });

  it('1단계는 칭찬하지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([], ctx(10_000, 7), good).show).toBeNull();
  });

  it('판정 8개부터 2단계로 모든 규칙을 띄우고 16개부터 3단계다', () => {
    const p = new CoachPolicy();
    const d = p.decide([on('A')], ctx(5_500, 8));
    expect(d.show?.key).toBe('A');
    expect(d.stage).toBe(2);
    expect(p.decide([], ctx(6_000, 15)).stage).toBe(2);
    expect(p.decide([], ctx(6_500, 16)).stage).toBe(3);
  });
});

describe('CoachPolicy 전역 간격', () => {
  it('문구 사이 간격이 4초 미만이면 다른 규칙도 띄우지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(10_000)).show?.key).toBe('A');
    expect(p.decide([on('B')], ctx(10_000 + minGapMs - 1)).show).toBeNull();
    expect(p.decide([on('B')], ctx(10_000 + minGapMs)).show?.key).toBe('B');
  });
});

describe('CoachPolicy 키별 쿨다운과 히스테리시스', () => {
  it('활성인 키는 10초가 지나야 다시 띄운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([on('A')], ctx(10_000 + minGapMs)).show).toBeNull();
    expect(p.decide([on('A')], ctx(10_000 + tagCooldownMs - 1)).show).toBeNull();
    expect(p.decide([on('A')], ctx(10_000 + tagCooldownMs)).show?.key).toBe('A');
  });

  it('거두는 조건을 만족한 키는 쿨다운 없이 다시 띄울 수 있다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    const mid = p.decide([ev('A', { release: true })], ctx(12_000));
    expect(mid.recovered.map((e) => e.key)).toEqual(['A']);
    // 간격(4초)만 지나면 쿨다운(10초) 전이어도 다시 띄운다
    expect(p.decide([on('A')], ctx(10_000 + minGapMs)).show?.key).toBe('A');
  });

  it('띄운 적 없는 키가 거두는 조건을 만족해도 recovered에 넣지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([ev('A', { release: true })], ctx(10_000)).recovered).toEqual([]);
  });

  it('거두는 처리는 시작 억제 중에도 한다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    // judged가 줄어든 상황(재시작 직후 등)에서도 recovered는 나온다
    expect(p.decide([ev('A', { release: true })], ctx(11_000, 1)).recovered).toHaveLength(1);
  });

  it('같은 태그라도 키(패드)가 다르면 따로 센다', () => {
    const p = new CoachPolicy();
    p.decide([on('LIVE_PAD_LATE:SNARE', { tag: 'LIVE_PAD_LATE' })], ctx(10_000));
    const r = p.decide([on('LIVE_PAD_LATE:HIHAT', { tag: 'LIVE_PAD_LATE' })], ctx(10_000 + minGapMs));
    expect(r.show?.key).toBe('LIVE_PAD_LATE:HIHAT');
  });
});

describe('CoachPolicy 플레이당 개수', () => {
  it('상한이 없어서 긴 곡 후반에도 계속 뜬다', () => {
    const p = new CoachPolicy();
    let t = 10_000;
    for (let i = 0; i < 100; i++) {
      expect(p.decide([on(`K${i}`)], ctx(t)).show?.key).toBe(`K${i}`);
      t += minGapMs;
    }
    expect(p.shownCount).toBe(100);
  });
});

describe('CoachPolicy 칭찬', () => {
  it('지적 후보가 없으면 칭찬을 띄우고, 다음 칭찬은 6초 뒤다', () => {
    const p = new CoachPolicy();
    expect(p.decide([], ctx(10_000), good).show?.key).toBe('LIVE_GOOD_STEADY');
    expect(p.decide([], ctx(10_000 + praiseGapMs - 1), good).show).toBeNull();
    expect(p.decide([], ctx(10_000 + praiseGapMs), good).show?.key).toBe('LIVE_GOOD_STEADY');
  });

  it('지적 후보가 있으면 칭찬보다 지적이 먼저다', () => {
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(10_000), good).show?.key).toBe('A');
  });

  it('칭찬은 지적을 늦추지 않는다', () => {
    const p = new CoachPolicy();
    p.decide([], ctx(10_000), good);
    expect(p.decide([on('A')], ctx(10_500), good).show?.key).toBe('A');
  });

  it('지적 뒤 칭찬은 쿨다운이 끝나기 전에 뜨지 않고, 지적 뒤 지적은 4초 간격을 지킨다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([on('A'), on('B')], ctx(10_000 + minGapMs - 1), good).show).toBeNull();
    expect(p.decide([on('A'), on('B')], ctx(10_000 + minGapMs), good).show?.key).toBe('B');
  });

  it('시작 억제 중에는 칭찬도 띄우지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([], ctx(5_000, 7), good).show).toBeNull();
  });

  it('후보가 null이면(놓침이 많으면) 칭찬하지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([], ctx(10_000), null).show).toBeNull();
  });

  it('칭찬은 키를 활성으로 만들지 않아 다음 칭찬을 막지 않는다', () => {
    const p = new CoachPolicy();
    p.decide([], ctx(10_000), good);
    expect(p.decide([good], ctx(10_000 + praiseGapMs), good).show).not.toBeNull();
  });

  it('활성 지적이 조건을 만족하는 동안은 쿨다운 안에서도 칭찬하지 않는다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([on('A')], ctx(10_000 + praiseGapMs), good).show).toBeNull();
  });

  it('활성 지적이 쿨다운 안이면 조건을 벗어나도 칭찬하지 않는다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([ev('A')], ctx(10_000 + tagCooldownMs - 1), good).show).toBeNull();
  });

  it('거두는 판단을 못 하는 키가 쿨다운을 넘기면 칭찬을 막지 않는다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([ev('A')], ctx(10_000 + tagCooldownMs), good).show?.key).toBe('LIVE_GOOD_STEADY');
  });
});

describe('CoachPolicy 경향 해소 칭찬', () => {
  it('지적이 거둬지면 4초 간격을 지나 고쳐졌다는 칭찬을 한 번 띄운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    expect(p.decide([ev('A', { release: true })], ctx(12_000), good).show).toBeNull();
    expect(p.decide([ev('A')], ctx(10_000 + minGapMs), good).show).toBe(RECOVERED_PRAISE);
    expect(p.decide([ev('A')], ctx(10_000 + 2 * minGapMs), good).show).toBeNull();
  });

  it('다른 지적이 활성이면 그 지적이 풀릴 때까지 기다린다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.decide([ev('A'), on('B')], ctx(10_000 + minGapMs));
    const t = 10_000 + 2 * minGapMs;
    expect(p.decide([ev('A', { release: true }), on('B')], ctx(t), good).show).toBeNull();
    expect(p.decide([ev('A'), ev('B', { release: true })], ctx(t + minGapMs), good).show).toBe(RECOVERED_PRAISE);
  });

  it('새 지적이 뜨면 밀린 칭찬을 버린다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.decide([ev('A', { release: true })], ctx(12_000), good);
    p.decide([ev('A'), on('B')], ctx(10_000 + minGapMs), good);
    p.decide([ev('B', { release: true })], ctx(10_000 + minGapMs + 1_000), good);
    // B가 거둬져서 생긴 칭찬 하나만 남는다
    expect(p.decide([], ctx(10_000 + 2 * minGapMs), good).show).toBe(RECOVERED_PRAISE);
    expect(p.decide([], ctx(10_000 + 3 * minGapMs), good).show?.key).not.toBe(RECOVERED_PRAISE.key);
  });

  it('연주가 안정되기 전에는 고쳐졌다고 하지 않고, 안정되면 띄운다', () => {
    const keep = ev('LIVE_GOOD_KEEP', { tag: 'LIVE_GOOD_KEEP', priority: 5, trigger: true });
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.decide([ev('A', { release: true })], ctx(12_000));
    expect(p.decide([], ctx(10_000 + keepGapMs), keep).show?.key).toBe('LIVE_GOOD_KEEP');
    expect(p.decide([], ctx(10_000 + keepGapMs + minGapMs), good).show).toBe(RECOVERED_PRAISE);
  });

  it('일반 칭찬(KEEP)은 직전 문구 후 20초가 지나야 뜬다', () => {
    const keep = ev('LIVE_GOOD_KEEP', { tag: 'LIVE_GOOD_KEEP', priority: 5, trigger: true });
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(10_000)).show?.key).toBe('A');
    expect(p.decide([], ctx(10_000 + keepGapMs - 1), keep).show).toBeNull();
    expect(p.decide([], ctx(10_000 + keepGapMs), keep).show?.key).toBe('LIVE_GOOD_KEEP');
    // 칭찬 뒤에도 20초를 다시 기다린다. 안정 칭찬은 6초 간격 그대로다
    expect(p.decide([], ctx(10_000 + keepGapMs + praiseGapMs), keep).show).toBeNull();
    expect(p.decide([], ctx(10_000 + keepGapMs + praiseGapMs), good).show?.key).toBe('LIVE_GOOD_STEADY');
  });

  it('해소 칭찬은 해소된 지적 중 가장 최근에 띄웠던 것을 recoveredFrom으로 싣는다', () => {
    const padTarget = { kind: 'pad', pad: 'SNARE' } as const;
    const p = new CoachPolicy();
    p.decide([on('A', { tag: 'LIVE_LATE' })], ctx(10_000));
    p.decide([ev('A'), on('B', { tag: 'LIVE_PAD_LATE', target: padTarget })], ctx(10_000 + minGapMs));
    const rel = p.decide(
      [ev('A', { tag: 'LIVE_LATE', release: true }), ev('B', { tag: 'LIVE_PAD_LATE', target: padTarget, release: true })],
      ctx(10_000 + minGapMs + 1_000),
    );
    expect(rel.recoveredFrom).toBeNull();
    const d = p.decide([], ctx(10_000 + 2 * minGapMs + 1_000), good);
    expect(d.show).toBe(RECOVERED_PRAISE);
    expect(d.recoveredFrom).toEqual({ tag: 'LIVE_PAD_LATE', target: padTarget });
  });

  it('해소 칭찬이 아닌 결정은 recoveredFrom이 null이고, 칭찬 뒤에는 기록을 비운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A', { tag: 'LIVE_LATE' })], ctx(10_000));
    p.decide([ev('A', { release: true })], ctx(12_000));
    expect(p.decide([], ctx(10_000 + minGapMs), good).recoveredFrom).toEqual({ tag: 'LIVE_LATE', target: null });
    expect(p.decide([], ctx(10_000 + minGapMs + praiseGapMs), good).recoveredFrom).toBeNull();
  });

  it('놓침이 많아 후보가 없으면 미뤘다가 후보가 생기면 띄운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.decide([ev('A', { release: true })], ctx(12_000));
    expect(p.decide([], ctx(10_000 + minGapMs), null).show).toBeNull();
    expect(p.decide([], ctx(10_000 + minGapMs + 500), good).show).toBe(RECOVERED_PRAISE);
  });
});

describe('CoachPolicy 반복 횟수', () => {
  it('같은 태그가 뜬 횟수를 태그별로 센다', () => {
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(10_000)).repeat).toBe(0);
    expect(p.decide([ev('A', { release: true }), on('A')], ctx(10_000 + minGapMs)).repeat).toBe(1);
    expect(p.decide([], ctx(30_000), good).repeat).toBe(0);
    expect(p.decide([], ctx(30_000 + praiseGapMs), good).repeat).toBe(1);
  });

  it('reset하면 다시 0부터 센다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.reset();
    expect(p.decide([on('A')], ctx(10_000)).repeat).toBe(0);
  });
});

describe('CoachPolicy 우선순위', () => {
  it('우선순위 숫자가 작은 규칙을 먼저 고른다', () => {
    const p = new CoachPolicy();
    const r = p.decide([on('LATE', { priority: 1, severity: 0.9 }), on('MISS', { priority: 0, severity: 0.1 })], ctx(10_000));
    expect(r.show?.key).toBe('MISS');
  });

  it('우선순위가 같으면 심한 쪽을 고른다', () => {
    const p = new CoachPolicy();
    const r = p.decide([on('A', { severity: 0.3 }), on('B', { severity: 0.8 })], ctx(10_000));
    expect(r.show?.key).toBe('B');
  });

  it('한 번에 하나만 띄운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A'), on('B'), on('C')], ctx(10_000));
    expect(p.shownCount).toBe(1);
  });
});

describe('CoachPolicy reset', () => {
  it('재시작하면 모든 상태를 비운다', () => {
    const p = new CoachPolicy();
    p.decide([on('A')], ctx(10_000));
    p.reset();
    expect(p.shownCount).toBe(0);
    expect(p.decide([on('A')], ctx(1_000)).show?.key).toBe('A');
  });
});
