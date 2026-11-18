import { describe, expect, it } from 'vitest';
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import { LatencyStatsLog, percentile } from './latencyStats';

const hit = (over: Partial<ResolvedHit>): ResolvedHit => ({
  id: 1,
  stickId: 0,
  pad: 'SNARE',
  velocity: 80,
  tHit: 1000,
  tRecv: 1005,
  tResolved: 1007,
  source: 'ble',
  pose: { pitch: 0, yaw: 0 },
  peakAccel: 6,
  judgedBy: 'stick',
  ...over,
});
const ev = (h: ResolvedHit, t = 0): DiagEvent => ({ type: 'resolved', hit: h, t });

describe('percentile', () => {
  it('빈 배열은 null, 한 개면 그 값', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
  });
  it('선형 보간', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([0, 100], 0.95)).toBeCloseTo(95);
    expect(percentile([30, 10, 20], 0)).toBe(10);
    expect(percentile([30, 10, 20], 1)).toBe(30);
  });
});

describe('LatencyStatsLog', () => {
  it('구간별 지연을 구한다', () => {
    const log = new LatencyStatsLog();
    log.push(ev(hit({ tAudio: 1010 })));
    const s = log.stats();
    expect(s.recv.p50).toBe(5);
    expect(s.resolve.p50).toBe(2);
    expect(s.audio.p50).toBe(3);
    expect(s.total.p50).toBe(10);
    expect(s.audio.n).toBe(1);
  });

  it('tAudio가 없는 타격은 오디오·전체에서 빠진다', () => {
    const log = new LatencyStatsLog();
    log.push(ev(hit({})));
    log.push(ev(hit({ tAudio: 1020 })));
    const s = log.stats();
    expect(s.recv.n).toBe(2);
    expect(s.audio.n).toBe(1);
    expect(s.total.n).toBe(1);
  });

  it('발행 뒤에 채워진 tAudio도 stats 때 읽는다(참조 보관)', () => {
    const log = new LatencyStatsLog();
    const h = hit({});
    log.push(ev(h));
    expect(log.stats().audio.n).toBe(0);
    h.tAudio = 1015;
    expect(log.stats().audio.p50).toBe(8);
  });

  it('p95는 느린 꼬리를 잡는다', () => {
    const log = new LatencyStatsLog();
    for (let i = 0; i < 19; i++) log.push(ev(hit({ tAudio: 1010 })));
    log.push(ev(hit({ tAudio: 1107 }))); // 판정→오디오 100ms
    const s = log.stats();
    expect(s.audio.p50).toBe(3);
    expect(s.audio.p95).toBeCloseTo(7.85, 1); // 선형 보간: 3 + (100 − 3) × 0.05
  });

  it('최근 N건만 유지하고 resolved가 아닌 이벤트는 무시한다', () => {
    const log = new LatencyStatsLog(3);
    for (let i = 0; i < 5; i++) log.push(ev(hit({ tRecv: 1000 + i }), i));
    log.push({ type: 'missed', noteIndex: 0, pad: 'SNARE', songTimeMs: 0, t: 9 });
    expect(log.series()).toHaveLength(3);
    expect(log.stats().lastT).toBe(4);
    log.clear();
    expect(log.stats().recv.n).toBe(0);
    expect(log.stats().lastT).toBeNull();
  });
});
