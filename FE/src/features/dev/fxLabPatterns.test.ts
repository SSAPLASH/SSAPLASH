import { describe, expect, it } from 'vitest';
import { LAB_JUDGEMENTS, LAB_PATTERNS, combineStats, isLabJudgement, labJudgementFields, hitsInWindow, isLabPattern, patternHitsPerLoop, patternLoopMs, type LabStats } from './fxLabPatterns';

describe('fxLabPatterns', () => {
  it('끔은 아무것도 치지 않는다', () => {
    expect(hitsInWindow('off', 0, 10000)).toEqual([]);
    expect(patternLoopMs('off')).toBe(0);
  });
  it('빈·거꾸로 구간은 비어 있다', () => {
    expect(hitsInWindow('beat8', 500, 500)).toEqual([]);
    expect(hitsInWindow('beat8', 900, 100)).toEqual([]);
  });
  it('구간은 (from, to] — 0ms 타격은 -1~0 구간에 속한다', () => {
    expect(hitsInWindow('stress', -1, 0)).toHaveLength(1);
    expect(hitsInWindow('stress', 0, 50)).toHaveLength(1);
  });
  it('스트레스: 1초에 20타, 전 패드(8종)를 모두 친다, 세기는 1~127', () => {
    const hits = hitsInWindow('stress', -1, 999);
    expect(hits).toHaveLength(20);
    expect(new Set(hits.map((h) => h.pad)).size).toBe(8);
    for (const h of hits) {
      expect(h.velocity).toBeGreaterThanOrEqual(1);
      expect(h.velocity).toBeLessThanOrEqual(127);
    }
    expect(hitsInWindow('stress', -1, 9999)).toHaveLength(200);
  });
  it('8비트: 한 마디(2000ms)에 하이햇 8·킥 2·스네어 2·크래시 1', () => {
    const hits = hitsInWindow('beat8', -1, 1999);
    const count = (pad: string) => hits.filter((h) => h.pad === pad).length;
    expect(count('HIHAT')).toBe(8);
    expect(count('KICK')).toBe(2);
    expect(count('SNARE')).toBe(2);
    expect(count('CRASH')).toBe(1);
    expect(patternLoopMs('beat8')).toBe(2000);
  });
  it('16분 필인: 125ms 간격 16타 + 킥, 점점 세어진다', () => {
    const hits = hitsInWindow('fill16', -1, 1999).filter((h) => h.pad !== 'KICK');
    expect(hits).toHaveLength(16);
    expect(hits[15]!.velocity).toBeGreaterThan(hits[0]!.velocity);
  });
  it('크래시 연타: 크래시·라이드만, 반복된다', () => {
    const hits = hitsInWindow('crash', -1, 1799);
    expect(hits).toHaveLength(12);
    expect(hits.every((h) => h.pad === 'CRASH' || h.pad === 'RIDE')).toBe(true);
  });
  it('나눈 구간의 합 = 통째 구간(루프 경계 포함), 같은 입력은 같은 결과', () => {
    for (const p of LAB_PATTERNS) {
      const whole = hitsInWindow(p.id, 0, 4321);
      const parts = [...hitsInWindow(p.id, 0, 777), ...hitsInWindow(p.id, 777, 2000), ...hitsInWindow(p.id, 2000, 4321)];
      expect(parts).toEqual(whole);
      expect(hitsInWindow(p.id, 0, 4321)).toEqual(whole);
    }
  });
  it('여러 바퀴에 걸친 구간 개수 = 바퀴 수 × 한 바퀴 타 수', () => {
    for (const p of LAB_PATTERNS) {
      const loop = patternLoopMs(p.id);
      if (!loop) continue;
      expect(hitsInWindow(p.id, -1, loop * 3 - 1)).toHaveLength(patternHitsPerLoop(p.id) * 3);
    }
  });
  it('id 검사', () => {
    expect(isLabPattern('stress')).toBe(true);
    expect(isLabPattern('nope')).toBe(false);
  });
});

describe('combineStats', () => {
  const s = (o: Partial<LabStats>): LabStats => ({ frameMsAvg: 0, frameMsP95: 0, fps: 0, alive: 0, dropped: 0, running: false, ...o });
  it('시간·파티클·버린 수는 합, fps는 평균, 루프는 OR', () => {
    const t = combineStats([s({ frameMsAvg: 0.5, frameMsP95: 1, fps: 60, alive: 10, dropped: 2, running: true }), s({ frameMsAvg: 0.25, frameMsP95: 0.5, fps: 30, alive: 5, dropped: 1 })]);
    expect(t).toEqual({ frameMsAvg: 0.75, frameMsP95: 1.5, fps: 45, alive: 15, dropped: 3, running: true });
  });
  it('빈 목록은 0·정지', () => {
    expect(combineStats([])).toEqual(s({}));
  });
});

describe('랩 판정 선택', () => {
  it('고정 선택은 그대로 필드로 바뀐다', () => {
    expect(labJudgementFields('none', 1)).toEqual({ judgement: null, deltaMs: null, stray: false });
    expect(labJudgementFields('perfect', 1)).toEqual({ judgement: 'PERFECT', deltaMs: 0, stray: false });
    expect(labJudgementFields('good-early', 1)).toMatchObject({ judgement: 'GOOD', deltaMs: -40 });
    expect(labJudgementFields('good-late', 1)).toMatchObject({ judgement: 'GOOD', deltaMs: 40 });
    expect(labJudgementFields('stray', 1)).toEqual({ judgement: null, deltaMs: null, stray: true });
  });
  it('섞기는 결정적이고 비율이 대략 60·30·10%', () => {
    expect(labJudgementFields('mix', 42)).toEqual(labJudgementFields('mix', 42));
    let perfect = 0;
    let good = 0;
    let stray = 0;
    const n = 4000;
    for (let i = 1; i <= n; i++) {
      const f = labJudgementFields('mix', i);
      if (f.stray) stray++;
      else if (f.judgement === 'PERFECT') perfect++;
      else if (f.judgement === 'GOOD') good++;
    }
    expect(perfect / n).toBeGreaterThan(0.52);
    expect(perfect / n).toBeLessThan(0.68);
    expect(good / n).toBeGreaterThan(0.24);
    expect(good / n).toBeLessThan(0.36);
    expect(stray / n).toBeGreaterThan(0.06);
    expect(stray / n).toBeLessThan(0.14);
  });
  it('id 검사', () => {
    expect(LAB_JUDGEMENTS).toHaveLength(6);
    expect(isLabJudgement('mix')).toBe(true);
    expect(isLabJudgement('miss')).toBe(false);
  });
});

describe('comboSeqSteps', () => {
  it('기본 순서 [2,10,50,0]은 PERFECT 3단계 뒤 MISS(콤보 0)', async () => {
    const { LAB_COMBO_DEFAULT, comboSeqSteps } = await import('./fxLabPatterns');
    expect(comboSeqSteps(LAB_COMBO_DEFAULT)).toEqual([
      { combo: 2, judgement: 'PERFECT' },
      { combo: 10, judgement: 'PERFECT' },
      { combo: 50, judgement: 'PERFECT' },
      { combo: 0, judgement: 'MISS' },
    ]);
  });
  it('정수가 아닌 값은 건너뛴다', async () => {
    const { comboSeqSteps } = await import('./fxLabPatterns');
    expect(comboSeqSteps([1.5, Number.NaN, 3])).toEqual([{ combo: 3, judgement: 'PERFECT' }]);
  });
});
