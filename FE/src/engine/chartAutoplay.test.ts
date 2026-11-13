import { describe, expect, it } from 'vitest';
import { createChartAutoplay, AUTOPLAY_TICK_MS } from './chartAutoplay';
import type { ChartNote } from '@/domain/song/chart';

const NOTES: ChartNote[] = Array.from({ length: 40 }, (_, i) => ({
  timeMs: 500 + i * 250,
  pad: i % 2 === 0 ? 'KICK' : 'SNARE',
  velocityHint: i === 3 ? undefined : 90,
}));

/** 곡 시각 = now − origin(재생 중일 때). 가짜 타이머를 직접 돌린다 */
function setup(notes: ChartNote[] = NOTES) {
  let now = 0;
  let origin = 0;
  let running = true;
  const played: { pad: string; velocity: number; at: number; canceled: boolean }[] = [];
  let fn: (() => void) | null = null;
  const ap = createChartAutoplay({
    notes,
    songTime: () => (running ? now - origin : null),
    play: (pad, velocity, at) => {
      const item = { pad, velocity, at, canceled: false };
      played.push(item);
      return () => {
        item.canceled = true;
      };
    },
    now: () => now,
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    visibility: () => 'visible',
  });
  return {
    ap,
    played,
    /** now를 to까지 25ms씩 진행하며 타이머를 돌린다 */
    advance(to: number) {
      while (now + AUTOPLAY_TICK_MS <= to) {
        now += AUTOPLAY_TICK_MS;
        fn?.();
      }
    },
    setOrigin: (o: number) => {
      origin = o;
    },
    setRunning: (r: boolean) => {
      running = r;
    },
    now: () => now,
  };
}

describe('chartAutoplay', () => {
  it('모든 노트를 빠짐·중복 없이 한 번씩, 올바른 시각에 예약한다', () => {
    const t = setup();
    t.setOrigin(1000); // 곡 시각 = now − 1000(카운트인 구간에서 시작)
    t.ap.start();
    t.advance(15_000);
    expect(t.played).toHaveLength(NOTES.length);
    NOTES.forEach((n, i) => {
      // 울릴 시각(performance.now) = 곡 시각이 n.timeMs가 되는 now = n.timeMs + 1000
      expect(t.played[i].at).toBeCloseTo(n.timeMs + 1000, 6);
      expect(t.played[i].pad).toBe(n.pad);
      expect(t.played[i].velocity).toBe(n.velocityHint ?? 100);
    });
  });

  it('일시정지 중에는 예약하지 않고, 재개하면 지난 노트를 다시 울리지 않는다', () => {
    const t = setup();
    t.ap.start();
    t.advance(1000); // 곡 시각 1000. 선행 200ms 안(~1200)까지 예약됨
    const before = t.played.length;
    expect(before).toBeGreaterThan(0);
    t.setRunning(false);
    t.advance(4000);
    expect(t.played).toHaveLength(before);
    // 3초 멈춘 동안 곡 시각은 안 흘렀다: 재개 시점 now=4000에서 곡 시각 1000이 되도록 원점을 3000으로
    t.setOrigin(3000);
    t.setRunning(true);
    t.advance(6000);
    const after = t.played.slice(before);
    const songTimes = after.map((p) => Math.round(p.at - 3000));
    expect(songTimes.length).toBeGreaterThan(0);
    expect(songTimes[0]).toBeGreaterThanOrEqual(1000); // 재개 시점 곡 시각 이전 노트는 없음
    expect(new Set(songTimes).size).toBe(songTimes.length);
  });

  it('50ms 넘게 지난 노트는 건너뛰고, stop하면 더 예약하지 않는다', () => {
    const t = setup();
    t.ap.start();
    t.advance(25);
    t.setOrigin(-2000); // 곡 시각이 2025로 점프(앞선 노트는 지난 노트). 시계 정지 없이 앞으로 점프한 경우
    t.advance(50);
    expect(t.played.every((p) => p.at >= t.now() - 50 - 200)).toBe(true);
    t.ap.stop();
    const n = t.played.length;
    t.advance(5000);
    expect(t.played).toHaveLength(n);
  });

  it('곡 시각이 뒤로 가면(재시작) 처음 노트부터 다시 예약한다', () => {
    const t = setup();
    t.ap.start();
    t.advance(2000);
    const first = t.played.length;
    t.setOrigin(t.now() + 500); // 곡 시각이 −500으로 리셋
    t.advance(t.now() + 1500);
    expect(t.played.length).toBeGreaterThan(first);
    expect(t.played[first].pad).toBe(NOTES[0].pad);
  });

  it('일시정지하면 아직 울리지 않은 예약 소리를 취소하고, 재개 뒤 그 노트를 한 번만 다시 예약한다', () => {
    const t = setup();
    t.ap.start();
    t.advance(1_100); // 곡 시각 1100: 1300까지 예약됨(1250 노트는 아직 울리기 전)
    const before = t.played.length;
    const ahead = t.played.filter((p) => p.at > t.now());
    expect(ahead.length).toBeGreaterThan(0);
    t.setRunning(false);
    t.advance(1_150);
    // 일시정지 시점에 아직 안 울린 소리만 취소된다
    expect(ahead.every((p) => p.canceled)).toBe(true);
    expect(t.played.slice(0, before).filter((p) => p.at <= 1_100).every((p) => !p.canceled)).toBe(true);
    // 재개: 곡 시각을 1100부터 이어간다(origin을 일시정지 시간만큼 민다)
    t.setOrigin(t.now() - 1_100);
    t.setRunning(true);
    t.advance(t.now() + 2_000);
    const live = t.played.filter((p) => !p.canceled);
    // 취소되지 않은 소리 기준으로 노트마다 한 번씩: 곡 시각 3100까지의 노트
    expect(live).toHaveLength(NOTES.filter((n) => n.timeMs <= 3_100 + 200).length);
  });

  it('stop하면 아직 울리지 않은 예약 소리를 취소한다', () => {
    const t = setup();
    t.ap.start();
    t.advance(400); // 곡 시각 400: 500 노트가 예약됨
    expect(t.played).toHaveLength(1);
    t.ap.stop();
    expect(t.played[0].canceled).toBe(true);
  });
});
