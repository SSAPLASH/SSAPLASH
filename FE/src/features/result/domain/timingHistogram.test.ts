import { describe, expect, it } from 'vitest';
import { timingHistogram } from './timingHistogram';
import type { PlayLog } from '@/domain/play/playLog';

type In = Pick<PlayLog, 'timing' | 'notes'>;

const mk = (deltas: (number | null)[], timing = { perfectMs: 25, goodMs: 60 }): In => ({
  timing,
  notes: deltas.map((d, i) => ({ index: i, timeMs: i * 500, pad: 'SNARE' as const, judgement: d === null ? null : ('GOOD' as const), deltaMs: d })),
});

describe('timingHistogram', () => {
  it('노트가 없으면 모두 0·null', () => {
    const h = timingHistogram(mk([]));
    expect(h.counts).toEqual(new Array(12).fill(0));
    expect(h.early).toBeNull();
    expect(h.late).toBeNull();
    expect(h.meanDeltaMs).toBeNull();
  });

  it('기본 12칸, 칸 수를 바꿀 수 있다', () => {
    expect(timingHistogram(mk([0])).counts).toHaveLength(12);
    expect(timingHistogram(mk([0]), 6).counts).toHaveLength(6);
  });

  it('경계값 −good은 첫 칸, +good은 마지막 칸, 0은 가운데 오른쪽 칸', () => {
    const h = timingHistogram(mk([-60, 0, 60]));
    expect(h.counts[0]).toBe(1);
    expect(h.counts[6]).toBe(1); // (0+60)/10 = 6
    expect(h.counts[11]).toBe(1);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('범위를 벗어난 Δ는 양 끝 칸으로 모은다', () => {
    const h = timingHistogram(mk([-500, 500]));
    expect(h.counts[0]).toBe(1);
    expect(h.counts[11]).toBe(1);
  });

  it('칸 폭 경계: 칸 폭 10ms에서 -50은 1번, -51은 0번', () => {
    const h = timingHistogram(mk([-50, -51]));
    expect(h.counts[1]).toBe(1);
    expect(h.counts[0]).toBe(1);
  });

  it('perfectIdx는 칸 중앙이 ±perfectMs 안인 칸만 true', () => {
    // 중앙: -55,-45,-35,-25,-15,-5,5,15,25,35,45,55 → |중앙| <= 25
    expect(timingHistogram(mk([])).perfectIdx).toEqual([false, false, false, true, true, true, true, true, true, false, false, false]);
  });

  it('판정 안 된 노트(deltaMs null)는 칸·평균에서 제외한다', () => {
    const h = timingHistogram(mk([null, 10, null]));
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(h.meanDeltaMs).toBe(10);
  });

  it('평균 Δ·early(음수 평균)·late(양수 평균)', () => {
    const h = timingHistogram(mk([-20, -10, 30, 0]));
    expect(h.meanDeltaMs).toBeCloseTo(0, 10);
    expect(h.early).toBe(-15);
    expect(h.late).toBe(30);
  });

  it('한쪽만 있으면 반대쪽은 null, Δ 0은 어느 쪽에도 넣지 않는다', () => {
    const a = timingHistogram(mk([-10, 0]));
    expect(a.early).toBe(-10);
    expect(a.late).toBeNull();
    const b = timingHistogram(mk([0, 0]));
    expect(b.early).toBeNull();
    expect(b.late).toBeNull();
    expect(b.meanDeltaMs).toBe(0);
  });

  it('goodMs가 다르면 칸 폭이 따라간다', () => {
    const h = timingHistogram(mk([-120, 119], { perfectMs: 50, goodMs: 120 }));
    expect(h.counts[0]).toBe(1);
    expect(h.counts[11]).toBe(1);
  });
});
