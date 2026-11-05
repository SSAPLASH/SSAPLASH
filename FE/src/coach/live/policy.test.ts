import { describe, expect, it } from 'vitest';
import { LIVE_COACH_CONFIG } from './config';
import { CoachPolicy } from './policy';
import type { RuleEvaluation } from './rules';

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
const { minGapMs, tagCooldownMs, maxPerPlay } = LIVE_COACH_CONFIG.policy;

describe('CoachPolicy 시작 억제', () => {
  it('판정이 8개 쌓이기 전에는 띄우지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(5_000, 7)).show).toBeNull();
    expect(p.decide([on('A')], ctx(5_500, 8))?.show?.key).toBe('A');
  });
});

describe('CoachPolicy 전역 간격', () => {
  it('문구 사이 간격이 8초 미만이면 다른 규칙도 띄우지 않는다', () => {
    const p = new CoachPolicy();
    expect(p.decide([on('A')], ctx(10_000)).show?.key).toBe('A');
    expect(p.decide([on('B')], ctx(10_000 + minGapMs - 1)).show).toBeNull();
    expect(p.decide([on('B')], ctx(10_000 + minGapMs)).show?.key).toBe('B');
  });
});

describe('CoachPolicy 키별 쿨다운과 히스테리시스', () => {
  it('활성인 키는 25초가 지나야 다시 띄운다', () => {
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
    // 간격(8초)만 지나면 쿨다운(25초) 전이어도 다시 띄운다
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

describe('CoachPolicy 플레이당 상한', () => {
  it('10개를 넘기지 않는다', () => {
    const p = new CoachPolicy();
    let t = 10_000;
    for (let i = 0; i < maxPerPlay; i++) {
      expect(p.decide([on(`K${i}`)], ctx(t)).show?.key).toBe(`K${i}`);
      t += minGapMs;
    }
    expect(p.shownCount).toBe(maxPerPlay);
    expect(p.decide([on('K99')], ctx(t)).show).toBeNull();
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
