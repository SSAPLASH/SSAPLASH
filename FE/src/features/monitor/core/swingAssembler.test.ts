import { describe, expect, it } from 'vitest';
import type { DecodedSwing } from '@/input/stickProtocol';
import { SWING_SAMPLE_PERIOD_MS, SWING_TIMEOUT_MS, SwingAssembler, toSeries } from './swingAssembler';

const SPC = 20;

/** 청크 c의 모든 값이 c+1인 SWING 청크 */
function chunk(hitSeq: number, c: number, count = 10): DecodedSwing {
  return {
    kind: 'swing',
    recvTime: 0,
    flags: 0,
    role: 0,
    magAnomaly: false,
    ambiguous: false,
    hitSeq,
    chunkIdx: c,
    chunkCount: count,
    samples: new Int16Array(SPC * 6).fill(c + 1),
  } as DecodedSwing;
}

describe('SwingAssembler', () => {
  it('10청크 순서대로 → complete, 200샘플', () => {
    const a = new SwingAssembler();
    let rec;
    for (let c = 0; c < 10; c++) rec = a.push(chunk(5, c), 0, 100 + c);
    expect(rec).toMatchObject({ key: '0-5', complete: true, timedOut: false, receivedChunks: 10, sampleCount: 200, missing: [] });
    expect(rec!.samples.length).toBe(1200);
    expect(rec!.firstT).toBe(100);
    expect(rec!.lastT).toBe(109);
  });

  it('순서가 바뀌어도 제자리에 들어가고 중복·범위 밖 청크는 무시', () => {
    const a = new SwingAssembler();
    for (const c of [3, 0, 1, 2, 2, 12, 4, 5, 6, 7, 8, 9, 9]) a.push(chunk(1, c), 0, 0);
    const rec = a.get('0-1')!;
    expect(rec.complete).toBe(true);
    expect(rec.receivedChunks).toBe(10);
    expect(rec.samples[3 * SPC * 6]).toBe(4);
    expect(rec.samples[0]).toBe(1);
    expect(rec.samples[1199]).toBe(10);
  });

  it('청크 3 누락 → tick 뒤 timedOut·missing [3]·그 자리 0', () => {
    const a = new SwingAssembler();
    for (let c = 0; c < 10; c++) if (c !== 3) a.push(chunk(2, c), 1, 1000);
    const rec = a.get('1-2')!;
    expect(rec.complete).toBe(false);
    expect(a.tick(1000 + SWING_TIMEOUT_MS)).toBe(0);
    expect(a.tick(1000 + SWING_TIMEOUT_MS + 1)).toBe(1);
    expect(rec.timedOut).toBe(true);
    expect(rec.missing).toEqual([3]);
    expect(rec.samples.slice(3 * SPC * 6, 4 * SPC * 6).every((v) => v === 0)).toBe(true);
    expect(rec.samples[2 * SPC * 6]).toBe(3);
    expect(a.tick(99999)).toBe(0);
  });

  it('두 스틱의 같은 hitSeq는 분리된다', () => {
    const a = new SwingAssembler();
    a.push(chunk(7, 0), 0, 0);
    a.push(chunk(7, 0), 1, 0);
    expect(a.list().map((r) => r.key)).toEqual(['1-7', '0-7']);
  });

  it('20개 상한, 최신 먼저', () => {
    const a = new SwingAssembler();
    for (let s = 0; s < 25; s++) a.push(chunk(s, 0), 0, 0);
    const keys = a.list().map((r) => r.key);
    expect(keys.length).toBe(20);
    expect(keys[0]).toBe('0-24');
    expect(keys[19]).toBe('0-5');
    expect(a.get('0-0')).toBeUndefined();
  });

  it('subscribe·version·clear', () => {
    const a = new SwingAssembler();
    let n = 0;
    const off = a.subscribe(() => n++);
    const v = a.version;
    a.push(chunk(1, 0), 0, 0);
    expect(a.version).toBe(v + 1);
    a.clear();
    expect(a.list()).toEqual([]);
    expect(n).toBe(2);
    off();
    a.push(chunk(1, 0), 0, 0);
    expect(n).toBe(2);
  });

  it('toSeries는 스케일을 적용하고 마지막 샘플이 0ms', () => {
    const a = new SwingAssembler();
    const p = chunk(1, 0, 1);
    p.samples.fill(0);
    p.samples.set([100, -200, 1000, 50, -50, 1234], 0);
    const rec = a.push(p, 0, 0);
    const s = toSeries(rec);
    expect(s.ax[0]).toBe(100);
    expect(s.ay[0]).toBe(-200);
    expect(s.az[0]).toBe(1000);
    expect(s.gx[0]).toBeCloseTo(5, 4);
    expect(s.gy[0]).toBeCloseTo(-5, 4);
    expect(s.gz[0]).toBeCloseTo(123.4, 3);
    expect(s.tMs.length).toBe(20);
    expect(s.tMs[0]).toBeCloseTo(-19 * 1.18, 4);
    expect(s.tMs[19]).toBe(0);
    expect(a.toSeries(rec).tMs[19]).toBe(0);
  });

  describe('EMB 회신 3 규격(청크 1개 = 샘플 1개)', () => {
    /** 샘플 1개짜리 청크. 값은 idx+1 */
    const one = (hitSeq: number, c: number, count = 169): DecodedSwing =>
      ({
        kind: 'swing',
        recvTime: 0,
        flags: 0,
        role: 0,
        magAnomaly: false,
        ambiguous: false,
        hitSeq,
        chunkIdx: c,
        chunkCount: count,
        samples: new Int16Array(6).fill(c + 1),
      }) as DecodedSwing;

    it('상수는 1.18ms·3초', () => {
      expect(SWING_SAMPLE_PERIOD_MS).toBe(1.18);
      expect(SWING_TIMEOUT_MS).toBe(3000);
    });

    it('1샘플 청크 169개 → complete·sampleCount 169·tMs 약 −198.2~0', () => {
      const a = new SwingAssembler();
      let rec;
      for (let c = 0; c < 169; c++) rec = a.push(one(3, c), 0, c);
      expect(rec).toMatchObject({ complete: true, receivedChunks: 169, sampleCount: 169, missing: [] });
      expect(rec!.samples.length).toBe(169 * 6);
      expect(rec!.samples[168 * 6]).toBe(169);
      const s = toSeries(rec!);
      expect(s.tMs.length).toBe(169);
      expect(s.tMs[0]).toBeCloseTo(-168 * 1.18, 3);
      expect(s.tMs[0]).toBeGreaterThan(-199.2);
      expect(s.tMs[0]).toBeLessThan(-198);
      expect(s.tMs[168]).toBe(0);
    });

    it('타임아웃: 2.9초 미확정, 3.1초 확정', () => {
      const a = new SwingAssembler();
      for (let c = 0; c < 169; c++) if (c < 80 || c > 84) a.push(one(4, c), 0, 1000);
      const rec = a.get('0-4')!;
      expect(rec.missing).toEqual([80, 81, 82, 83, 84]);
      expect(a.tick(1000 + 2900)).toBe(0);
      expect(rec.timedOut).toBe(false);
      expect(a.tick(1000 + 3100)).toBe(1);
      expect(rec.timedOut).toBe(true);
    });
  });
});
