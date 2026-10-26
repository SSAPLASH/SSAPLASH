import { describe, expect, it } from 'vitest';
import { clockHealth, HEALTH_THRESHOLDS as TH, sensorHealth, transportHealth, type HealthInput, type StageHealth } from './health';
import type { LogRow, MonitorStats, StickStats, SyncSample } from './packetLog';

const NOW = 100_000;

const stick = (over: Partial<StickStats> = {}): StickStats => ({
  hitSeqLoss: { window: 0, total: 0 },
  poseSeqLoss: { window: 0, total: 0, pct: null },
  hitFuture: { median: null, max: null },
  statusAgeMs: null,
  lastStatus: null,
  hitCount: 0,
  lastHitT: null,
  ...over,
});

function mkStats(over: Partial<MonitorStats> = {}): MonitorStats {
  return {
    ratePerType: {},
    perStick: [stick(), stick()],
    bridge: { last: null, delta1s: { okFrames: 0, crcErrors: 0, resyncCount: 0 }, ageMs: null, stalled: false },
    drops: {},
    i2cRecoveries: null,
    build: null,
    sync: { samples: [], adopted: [], lastLagMs: null, count: 0, unmatched: 0 },
    padTable: { entries: [], t: null },
    errorCount: 0,
    total: 0,
    ...over,
  };
}

/** 수신 행 하나. decoded는 필요한 필드만 채운다 */
const row = (t: number, kind: string, extra: Record<string, unknown> = {}): LogRow =>
  ({
    id: Math.round(t),
    t,
    dir: 'in',
    transport: 'serial',
    stick: 0,
    bytes: new Uint8Array(0),
    decoded: { kind, ...extra },
    outType: null,
    tBrowser: null,
    futureMs: null,
    log: null,
  }) as unknown as LogRow;

const mkSnap = (over: Partial<HealthInput> = {}): HealthInput => ({
  stats: mkStats(),
  rows: [],
  transport: null,
  offsets: [null, null],
  ...over,
});

const item = (h: StageHealth, key: string) => h.items.find((i) => i.key === key)!;

describe('transportHealth', () => {
  it('데이터가 없으면 idle', () => {
    const h = transportHealth(mkSnap(), NOW);
    expect(h.level).toBe('idle');
    expect(h.reason).toBe('데이터 없음');
    expect(h.lastUpdate).toBeNull();
  });

  it('수신 경과 2초 경계: 2000ms는 ok, 직후는 bad 항목', () => {
    const ok = transportHealth(mkSnap({ rows: [row(NOW - 2000, 'status')] }), NOW);
    expect(item(ok, 'recv').level).toBe('ok');
    const stale = transportHealth(mkSnap({ rows: [row(NOW - 2001, 'status')] }), NOW);
    expect(item(stale, 'recv').level).toBe('bad');
  });

  it('전송은 무수신이 길어져도 idle로 바꾸지 않고 bad로 남는다(끊긴 링크를 빨강으로)', () => {
    const h = transportHealth(mkSnap({ rows: [row(NOW - 5200, 'status')] }), NOW);
    expect(h.level).toBe('bad');
    expect(h.reason).toBe('5.2초째 수신 없음 (기준 2초)');
    expect(item(h, 'recv').value).toBe('5.2');
    expect(item(h, 'recv').level).toBe('bad');
  });

  it('POSE 유실 2% 경계: 2.0은 ok, 2.01은 warn', () => {
    const mk = (pct: number) =>
      transportHealth(
        mkSnap({
          rows: [row(NOW - 10, 'pose')],
          stats: mkStats({ perStick: [stick({ poseSeqLoss: { window: 0, total: 0, pct } }), stick()] }),
        }),
        NOW,
      );
    expect(mk(TH.transport.poseLossWarnPct).level).toBe('ok');
    const w = mk(TH.transport.poseLossWarnPct + 0.01);
    expect(w.level).toBe('warn');
    expect(w.reason).toBe('POSE 유실 2.0% (기준 2%)');
  });

  it('POSE 유실 10% 경계: 10.0은 warn, 10.01은 bad이며 이유에 이상 기준이 나온다', () => {
    const mk = (pct: number) =>
      transportHealth(
        mkSnap({
          rows: [row(NOW - 10, 'pose')],
          stats: mkStats({ perStick: [stick(), stick({ poseSeqLoss: { window: 0, total: 0, pct } })] }),
        }),
        NOW,
      );
    expect(mk(10).level).toBe('warn');
    const b = mk(10.01);
    expect(b.level).toBe('bad');
    expect(b.reason).toBe('POSE 유실 10.0% (기준 10%)');
  });

  it('HIT 유실은 1초 창에 1건이어도 warn, 0건이면 ok', () => {
    const mk = (win: number) =>
      transportHealth(
        mkSnap({
          rows: [row(NOW - 10, 'hit')],
          stats: mkStats({ perStick: [stick({ hitCount: 3, hitSeqLoss: { window: win, total: win } }), stick()] }),
        }),
        NOW,
      );
    expect(item(mk(0), 'hitLoss').level).toBe('ok');
    expect(item(mk(1), 'hitLoss').level).toBe('warn');
  });

  it('브리지 CRC·resync 증가가 있으면 warn, 없으면 ok. 브리지가 없으면 idle(직결은 누적만)', () => {
    const bridge = (crc: number, resync: number) =>
      mkStats({
        bridge: {
          last: { okFrames: 1, crcErrors: crc, resyncCount: resync } as never,
          delta1s: { okFrames: 0, crcErrors: crc, resyncCount: resync },
          ageMs: 10,
          stalled: false,
        },
      });
    const rows = [row(NOW - 10, 'bridgeStats')];
    expect(item(transportHealth(mkSnap({ rows, stats: bridge(0, 0) }), NOW), 'crc').level).toBe('ok');
    expect(item(transportHealth(mkSnap({ rows, stats: bridge(1, 0) }), NOW), 'crc').level).toBe('warn');
    expect(item(transportHealth(mkSnap({ rows, stats: bridge(0, 1) }), NOW), 'crc').level).toBe('warn');
    expect(item(transportHealth(mkSnap({ rows }), NOW), 'crc').level).toBe('idle');
  });

  it('가장 나쁜 항목이 단계 level과 reason이 된다(idle 항목은 제외)', () => {
    const h = transportHealth(
      mkSnap({
        rows: [row(NOW - 10, 'pose')],
        stats: mkStats({
          perStick: [
            stick({ poseSeqLoss: { window: 0, total: 0, pct: 4.2 }, hitCount: 1, hitSeqLoss: { window: 1, total: 1 } }),
            stick(),
          ],
        }),
      }),
      NOW,
    );
    expect(h.level).toBe('warn');
    expect(h.reason).toBe('POSE 유실 4.2% (기준 2%)');
    const b = transportHealth(
      mkSnap({
        rows: [row(NOW - 10, 'pose')],
        stats: mkStats({ perStick: [stick({ poseSeqLoss: { window: 0, total: 0, pct: 4.2 } }), stick({ poseSeqLoss: { window: 0, total: 0, pct: 30 } })] }),
      }),
      NOW,
    );
    expect(b.level).toBe('bad');
    expect(b.reason).toContain('30.0%');
  });

  it('전부 ok면 reason은 "정상"이고 패킷 레이트는 송신을 뺀 합이 headline', () => {
    const h = transportHealth(
      mkSnap({
        rows: [row(NOW - 10, 'pose')],
        stats: mkStats({
          ratePerType: { pose: 98, hit: 2, out: 5 },
          perStick: [stick({ poseSeqLoss: { window: 0, total: 0, pct: 0 } }), stick()],
        }),
      }),
      NOW,
    );
    expect(h.level).toBe('ok');
    expect(h.reason).toBe('정상');
    expect(h.headline).toEqual({ value: '100', unit: '패킷/s' });
    expect(item(h, 'rate').level).toBe('idle');
  });
});

describe('sensorHealth', () => {
  it('STATUS 3초 경계', () => {
    const mk = (age: number) =>
      sensorHealth(
        mkSnap({ rows: [row(NOW - 10, 'pose')], stats: mkStats({ perStick: [stick({ statusAgeMs: age }), stick()] }) }),
        NOW,
      );
    expect(item(mk(TH.sensor.statusWarnMs), 'status').level).toBe('ok');
    const w = mk(TH.sensor.statusWarnMs + 1);
    expect(item(w, 'status').level).toBe('warn');
    expect(w.reason).toBe('STATUS L 3.0초째 없음 (기준 3초)');
  });

  it('ambiguous 20% 경계와 최소 표본', () => {
    const hits = (n: number, amb: number) =>
      Array.from({ length: n }, (_, i) => row(NOW - 100 + i, 'hit', { ambiguous: i < amb }));
    expect(item(sensorHealth(mkSnap({ rows: hits(10, 2) }), NOW), 'ambiguous').level).toBe('ok'); // 20%
    expect(item(sensorHealth(mkSnap({ rows: hits(10, 3) }), NOW), 'ambiguous').level).toBe('warn'); // 30%
    const few = item(sensorHealth(mkSnap({ rows: hits(9, 9) }), NOW), 'ambiguous');
    expect(few.level).toBe('idle');
    expect(few.value).toBe('100');
  });

  it('ambiguous는 최근 50건만 센다', () => {
    const old = Array.from({ length: 60 }, (_, i) => row(NOW - 1000 + i, 'hit', { ambiguous: true }));
    const fresh = Array.from({ length: 50 }, (_, i) => row(NOW - 500 + i, 'hit', { ambiguous: false }));
    expect(item(sensorHealth(mkSnap({ rows: [...old, ...fresh] }), NOW), 'ambiguous').level).toBe('ok');
  });

  it('거른 스윙은 1분 창 통계가 없어 idle(값은 누적)', () => {
    const h = sensorHealth(
      mkSnap({ rows: [row(NOW - 10, 'hit')], stats: mkStats({ drops: { weak: { total: 4, window: 0 } } }) }),
      NOW,
    );
    expect(item(h, 'drop').level).toBe('idle');
    expect(item(h, 'drop').value).toContain('4');
  });

  it('데이터 나이 10초 경계, HIT/s headline', () => {
    const fresh = sensorHealth(mkSnap({ rows: [row(NOW - 10_000, 'pose')], stats: mkStats({ ratePerType: { hit: 3 }, perStick: [stick({ statusAgeMs: 100 }), stick()] }) }), NOW);
    expect(fresh.level).toBe('ok');
    expect(fresh.headline).toEqual({ value: '3', unit: 'HIT/s' });
    const stale = sensorHealth(mkSnap({ rows: [row(NOW - 10_001, 'pose')] }), NOW);
    expect(stale.level).toBe('idle');
    expect(stale.reason).toBe('10초 전 마지막 데이터');
  });
});

describe('clockHealth', () => {
  /** 스틱 0의 관측 오프셋이 분당 slope ms로 흐르는 표본(5초 간격 n개) */
  const samples = (slope: number, n = 8, rtt = 10): SyncSample[] =>
    Array.from({ length: n }, (_, i) => {
      const t = NOW - (n - i) * 5000;
      return { t, stick: 0, t0: t - rtt, t1Ms: 0, rttMs: rtt, offsetObsMs: (slope * (t - NOW)) / 60_000 };
    });
  const mk = (xs: SyncSample[], over: Partial<MonitorStats> = {}) =>
    clockHealth(mkSnap({ stats: mkStats({ sync: { samples: xs, adopted: [], lastLagMs: null, count: xs.length, unmatched: 0 }, ...over }) }), NOW);

  it('기울기 1·5 경계', () => {
    expect(item(mk(samples(1)), 'slope').level).toBe('ok');
    expect(item(mk(samples(1.2)), 'slope').level).toBe('warn');
    expect(item(mk(samples(-5)), 'slope').level).toBe('warn');
    expect(item(mk(samples(5.5)), 'slope').level).toBe('bad');
    expect(item(mk(samples(-5.5)), 'slope').level).toBe('bad');
  });

  it('표본이 적거나 시간 폭이 좁으면 기울기는 idle', () => {
    expect(item(mk(samples(9, 4)), 'slope').level).toBe('idle');
    const narrow = samples(9, 8).map((s, i) => ({ ...s, t: NOW - 8000 + i * 1000 }));
    expect(item(mk(narrow), 'slope').level).toBe('idle');
  });

  it('rtt 중앙값 20ms 경계', () => {
    expect(item(mk(samples(0, 8, 20)), 'rtt').level).toBe('ok');
    const w = mk(samples(0, 8, 20.5));
    expect(item(w, 'rtt').level).toBe('warn');
    expect(w.reason).toBe('SYNC rtt 20.5ms (기준 20ms)');
  });

  it('짝 실패 1건이면 warn, ACK가 없으면 idle', () => {
    const w = clockHealth(
      mkSnap({ stats: mkStats({ sync: { samples: samples(0), adopted: [], lastLagMs: null, count: 8, unmatched: 1 } }) }),
      NOW,
    );
    expect(item(w, 'unmatched').level).toBe('warn');
    expect(item(mk([]), 'unmatched').level).toBe('idle');
  });

  it('futureMs 최대 50ms 경계', () => {
    const f = (max: number) =>
      mk(samples(0), { perStick: [stick({ hitFuture: { median: 1, max } }), stick()] });
    expect(item(f(50), 'future').level).toBe('ok');
    expect(item(f(50.1), 'future').level).toBe('warn');
  });

  it('데이터 없으면 idle, 마지막 SYNC가 30초보다 오래되면 idle과 경과 이유', () => {
    expect(mk([]).level).toBe('idle');
    const stale = mk(samples(0).map((s) => ({ ...s, t: s.t - 31_000 })));
    expect(stale.level).toBe('idle');
    expect(stale.reason).toMatch(/초 전 마지막 데이터$/);
  });

  it('채택 오프셋은 기준 없는 표시용(idle)이라 단계 상태에 영향이 없다', () => {
    const h = clockHealth(mkSnap({ offsets: [12.345, null], stats: mkStats({ sync: { samples: samples(0), adopted: [], lastLagMs: null, count: 8, unmatched: 0 } }) }), NOW);
    expect(item(h, 'adopted').level).toBe('idle');
    expect(item(h, 'adopted').value).toBe('L 12.35 · R –');
    expect(h.level).toBe('ok');
  });
});
