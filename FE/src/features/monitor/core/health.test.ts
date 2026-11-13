import { describe, expect, it } from 'vitest';
import {
  arrivalLevel,
  clockHealth,
  HEALTH_THRESHOLDS as TH,
  keyMetrics,
  outputHealth,
  resolveHealth,
  scoreHealth,
  sensorHealth,
  transportHealth,
  type HealthInput,
  type StageHealth,
} from './health';
import type { ResolveStats, ScoreStats } from './recording/judgeLog';
import type { LatencyStats } from './latencyStats';
import type { LogRow, MonitorStats, StickStats, SyncSample } from './recording/packetLog';

const NOW = 100_000;

const stick = (over: Partial<StickStats> = {}): StickStats => ({
  hitSeqLoss: { window: 0, total: 0 },
  poseSeqLoss: { window: 0, total: 0, pct: null },
  hitFuture: { median: null, max: null, min: null },
  hitLoss1m: 0,
  statusAgeMs: null,
  lastStatus: null,
  hitCount: 0,
  lastHitT: null,
  bias: null,
  imuFail: false,
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
    pedal: {
      present: false,
      lastStatus: [null, null],
      statusAgeMs: [null, null],
      sync: { count: 0, unmatched: 0, lastRttMs: null, minRttMs: null, offsetObsMs: null },
    },
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

  it('IMU·바이어스: default 주의, IMU FAIL 이상, 정상 ok, 로그 없으면 idle', () => {
    const mk = (a: Partial<StickStats>, b: Partial<StickStats> = {}) =>
      sensorHealth(mkSnap({ rows: [row(NOW - 10, 'pose')], stats: mkStats({ perStick: [stick(a), stick(b)] }) }), NOW);
    expect(item(mk({}), 'imu').level).toBe('idle');
    expect(item(mk({ bias: 'measured' }), 'imu')).toMatchObject({ level: 'ok', value: 'L 정상 · R –' });
    const w = mk({ bias: 'measured' }, { bias: 'default' });
    expect(item(w, 'imu').level).toBe('warn');
    expect(w.reason).toBe('부팅 때 흔들림, 바이어스 기본값 R');
    const b = mk({ bias: 'default' }, { imuFail: true });
    expect(item(b, 'imu').level).toBe('bad');
    expect(b.level).toBe('bad');
    expect(b.reason).toBe('IMU 초기화 실패 R (LOG IMU FAIL)');
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

  it('rtt 중앙값 25ms 경계', () => {
    expect(item(mk(samples(0, 8, 25)), 'rtt').level).toBe('ok');
    const w = mk(samples(0, 8, 25.5));
    expect(item(w, 'rtt').level).toBe('warn');
    expect(w.reason).toBe('SYNC rtt 25.5ms (기준 25ms)');
  });

  it('짝 실패 1건이면 warn, ACK가 없으면 idle', () => {
    const w = clockHealth(
      mkSnap({ stats: mkStats({ sync: { samples: samples(0), adopted: [], lastLagMs: null, count: 8, unmatched: 1 } }) }),
      NOW,
    );
    expect(item(w, 'unmatched').level).toBe('warn');
    expect(item(mk([]), 'unmatched').level).toBe('idle');
  });

  it('도착(수신−정지): 정상(−5)은 ok, 중앙값 0 초과 주의, −20 미만 주의, 최대 +20 초과 이상', () => {
    // 내부 값 futureMs = −도착. 도착 중앙값 d, 도착 최대 m → future median −d, future min −m
    const f = (d: number, m: number) =>
      mk(samples(0), { perStick: [stick({ hitFuture: { median: -d, max: -d + 3, min: -m } }), stick()] });
    expect(item(f(-5, -2), 'arrival')).toMatchObject({ level: 'ok', value: 'L -5.0/-2.0 · R –/–' });
    expect(item(f(-11, 0), 'arrival').level).toBe('ok');
    expect(item(f(0, 5), 'arrival').level).toBe('ok');
    const late = f(0.1, 5);
    expect(item(late, 'arrival').level).toBe('warn');
    expect(late.reason).toBe('도착 L 0.1ms — 수신이 정지 시각보다 늦음 — 전송 지연');
    expect(item(f(-20, 0), 'arrival').level).toBe('ok');
    const early = f(-20.1, -15);
    expect(item(early, 'arrival').level).toBe('warn');
    expect(early.reason).toBe('도착 L -20.1ms — 너무 이름 — tsCorrUs·시계 확인');
    expect(item(f(-5, 20), 'arrival').level).toBe('ok');
    expect(item(f(-5, 20.1), 'arrival').level).toBe('bad');
    expect(item(mk(samples(0)), 'arrival').level).toBe('idle');
  });

  it('arrivalLevel은 HIT 행 한 건에도 같은 기준을 낸다', () => {
    expect(arrivalLevel(-5, -5).level).toBe('ok');
    expect(arrivalLevel(1, 1).level).toBe('warn');
    expect(arrivalLevel(25, 25).level).toBe('bad');
    expect(arrivalLevel(null, null).level).toBe('idle');
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

// ───────────────────────── ④⑤⑥ ─────────────────────────

const mkResolve = (over: Partial<ResolveStats> = {}): ResolveStats => ({
  lastT: NOW - 1000,
  total: 20,
  judgedBy: { stick: 20, pose: 0, chart: 0, key: 0 },
  judgedByN: 20,
  padMismatch: { compared: 20, mismatched: 0, pct: 0 },
  inside: { n: 20, insideCount: 20, pct: 100, distanceMedian: 3 },
  padNull: { n: 0, window: 20 },
  ...over,
});

describe('resolveHealth', () => {
  const T = TH.resolve;

  it('정상이면 ok와 agree % 대표 숫자', () => {
    const h = resolveHealth(mkResolve({ padMismatch: { compared: 20, mismatched: 1, pct: 5 } }), NOW);
    expect(h.level).toBe('ok');
    expect(h.headline).toEqual({ value: '95', unit: '% 일치' });
  });

  it('펌웨어 pad 불일치 10% 경계(초과부터 warn)', () => {
    const f = (mismatched: number) =>
      resolveHealth(mkResolve({ padMismatch: { compared: 20, mismatched, pct: (mismatched / 20) * 100 } }), NOW);
    expect(item(f(2), 'padMismatch').level).toBe('ok'); // 10%
    expect(item(f(3), 'padMismatch').level).toBe('warn'); // 15%
    expect(f(3).level).toBe('warn');
    expect(f(3).reason).toMatch(/불일치 15% \(기준 10%\)/);
  });

  it('표본이 최소 건수 미만이면 idle과 사유', () => {
    const h = resolveHealth(mkResolve({ padMismatch: { compared: T.minSamples - 1, mismatched: 2, pct: 50 } }), NOW);
    expect(item(h, 'padMismatch').level).toBe('idle');
    expect(item(h, 'padMismatch').basis).toMatch(/표본 4건/);
  });

  it('짝 지을 seq가 없으면 데이터 없음', () => {
    const h = resolveHealth(mkResolve({ padMismatch: { compared: 0, mismatched: 0, pct: null } }), NOW);
    expect(item(h, 'padMismatch').level).toBe('idle');
    expect(item(h, 'padMismatch').basis).toMatch(/^데이터 없음/);
    expect(h.headline).toBeNull();
  });

  it('바운더리 안 비율 80% 경계(미만부터 warn)', () => {
    const f = (pct: number) => resolveHealth(mkResolve({ inside: { n: 20, insideCount: pct / 5, pct, distanceMedian: 6 } }), NOW);
    expect(item(f(80), 'inside').level).toBe('ok');
    expect(item(f(75), 'inside').level).toBe('warn');
    expect(item(f(75), 'inside').value).toBe('75% · 6.0°');
  });

  it('패드 없음 1건이면 warn', () => {
    expect(item(resolveHealth(mkResolve(), NOW), 'padNull').level).toBe('ok');
    const h = resolveHealth(mkResolve({ padNull: { n: 1, window: 20 } }), NOW);
    expect(item(h, 'padNull').level).toBe('warn');
    expect(h.reason).toMatch(/패드 없음 1건/);
  });

  it('가장 나쁜 항목이 단계 이유가 된다', () => {
    const h = resolveHealth(
      mkResolve({ inside: { n: 20, insideCount: 10, pct: 50, distanceMedian: 9 }, padNull: { n: 2, window: 20 } }),
      NOW,
    );
    expect(h.level).toBe('warn');
    expect(h.reason).toMatch(/바운더리/); // 같은 등급이면 앞쪽 항목
  });

  it('데이터가 없으면 idle, 10초 넘으면 idle과 경과 이유(값은 유지)', () => {
    const empty = resolveHealth(
      mkResolve({
        lastT: null,
        total: 0,
        judgedByN: 0,
        padMismatch: { compared: 0, mismatched: 0, pct: null },
        inside: { n: 0, insideCount: 0, pct: null, distanceMedian: null },
        padNull: { n: 0, window: 0 },
      }),
      NOW,
    );
    expect(empty.level).toBe('idle');
    expect(empty.reason).toBe('데이터 없음');
    const stale = resolveHealth(mkResolve({ lastT: NOW - T.validMs - 1 }), NOW);
    expect(stale.level).toBe('idle');
    expect(stale.reason).toMatch(/초 전 마지막 데이터$/);
    expect(item(stale, 'padNull').value).toBe('0');
    expect(resolveHealth(mkResolve({ lastT: NOW - T.validMs }), NOW).level).toBe('ok');
  });
});

const mkScore = (over: Partial<ScoreStats> = {}): ScoreStats => ({
  session: {
    mode: 'RHYTHM',
    songId: 's',
    title: '곡',
    chartVersionId: null,
    windows: { perfectMs: 25, goodMs: 60 },
    audioOffsetMs: 0, kickOffsetMs: 0,
    noteCount: 10,
    status: 'running',
    endReason: null,
    startedAt: NOW - 20_000,
  },
  lastT: NOW - 500,
  counts: { PERFECT: 5, GOOD: 2, MISS: 1 },
  score: 620,
  maxScore: 1000,
  combo: 3,
  maxCombo: 5,
  stray: 1,
  judgedCount: 8,
  delta: { n: 20, mean: 2, std: 6 },
  recent: [],
  notes: null,
  ...over,
});
const withDelta = (mean: number, n = 20) => mkScore({ delta: { n, mean, std: 5 } });

describe('scoreHealth', () => {
  it('delta 평균 절댓값 10ms·20ms 경계(초과부터)', () => {
    expect(scoreHealth(withDelta(10), NOW).level).toBe('ok');
    expect(scoreHealth(withDelta(10.1), NOW).level).toBe('warn');
    expect(scoreHealth(withDelta(-10.1), NOW).level).toBe('warn');
    expect(scoreHealth(withDelta(20), NOW).level).toBe('warn');
    expect(scoreHealth(withDelta(20.1), NOW).level).toBe('bad');
    expect(scoreHealth(withDelta(-25), NOW).level).toBe('bad');
  });

  it('표본이 최소 판정 수 미만이면 delta는 idle', () => {
    const h = scoreHealth(withDelta(30, TH.score.minJudgements - 1), NOW);
    expect(item(h, 'delta').level).toBe('idle');
    expect(h.level).toBe('idle');
  });

  it('이유에 부호 있는 평균과 기준이 들어가고 대표 숫자는 평균 delta', () => {
    const h = scoreHealth(withDelta(12.34), NOW);
    expect(h.reason).toBe('delta 평균 +12.3ms (기준 10ms)');
    expect(h.headline).toEqual({ value: '+12.3', unit: 'ms' });
    expect(item(h, 'delta').value).toBe('+12.3 · σ 5.0');
  });

  it('세션 종료 뒤에는 idle로 바꾸지 않고 값을 고정, 이유에 세션 종료', () => {
    const ended = mkScore({
      session: { ...mkScore().session!, status: 'ended', endReason: 'finished' },
      lastT: NOW - 600_000,
      delta: { n: 20, mean: 15, std: 4 },
    });
    const h = scoreHealth(ended, NOW);
    expect(h.level).toBe('warn');
    expect(h.reason).toMatch(/^세션 종료 · delta 평균/);
  });

  it('세션이 없으면(직접 연결) idle과 안내, 항목은 데이터 없음', () => {
    const h = scoreHealth(mkScore({ session: null, lastT: null, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, delta: { n: 0, mean: null, std: null } }), NOW);
    expect(h.level).toBe('idle');
    expect(h.reason).toMatch(/따라보기/);
    expect(item(h, 'counts').basis).toMatch(/^데이터 없음/);
    expect(item(h, 'delta').basis).toMatch(/^데이터 없음/);
  });

  it('세션이 있어도 판정이 아직 없으면 idle', () => {
    const h = scoreHealth(mkScore({ delta: { n: 0, mean: null, std: null }, lastT: NOW }), NOW);
    expect(h.level).toBe('idle');
    expect(h.reason).toBe('데이터 없음');
  });

  it('카운트·점수·콤보·stray는 표시용이라 상태에 영향이 없다', () => {
    const h = scoreHealth(mkScore(), NOW);
    expect(item(h, 'counts').value).toBe('P 5 · G 2 · M 1');
    expect(item(h, 'score').value).toBe('620/1000 · 콤보 3 (최대 5)');
    expect(item(h, 'stray').value).toBe('1');
    expect(h.level).toBe('ok');
  });
});

const q = (p50: number | null, p95: number | null, n = 20) => ({ n, p50, p95 });
const mkLat = (over: Partial<LatencyStats> = {}): LatencyStats => ({
  recv: q(5, 9),
  resolve: q(1, 2),
  audio: q(3, 8),
  total: q(9, 18),
  lastT: NOW - 1000,
  ...over,
});

describe('outputHealth', () => {
  const T = TH.output;

  it('판정→오디오 p95 20ms 경계(초과부터 warn)', () => {
    expect(item(outputHealth(mkLat({ audio: q(3, 20) }), null, NOW), 'audio').level).toBe('ok');
    const h = outputHealth(mkLat({ audio: q(3, 20.1) }), null, NOW);
    expect(item(h, 'audio').level).toBe('warn');
    expect(h.reason).toBe('판정→오디오 p95 20.1ms (기준 20ms)');
  });

  it('전체 p95 40ms 경계(초과부터 warn)', () => {
    expect(item(outputHealth(mkLat({ total: q(9, 40) }), null, NOW), 'total').level).toBe('ok');
    expect(item(outputHealth(mkLat({ total: q(9, 40.1) }), null, NOW), 'total').level).toBe('warn');
  });

  it('둘 다 넘으면 앞쪽(판정→오디오)이 이유가 된다', () => {
    const h = outputHealth(mkLat({ audio: q(3, 30), total: q(9, 60) }), null, NOW);
    expect(h.level).toBe('warn');
    expect(h.reason).toMatch(/^판정→오디오/);
  });

  it('센서→수신·수신→판정은 표시용이라 아무리 커도 상태에 영향이 없다', () => {
    const h = outputHealth(mkLat({ recv: q(80, 200), resolve: q(40, 90) }), null, NOW);
    expect(item(h, 'recv').level).toBe('idle');
    expect(item(h, 'resolve').level).toBe('idle');
    expect(h.level).toBe('ok');
  });

  it('tAudio가 없으면 오디오·전체는 idle(데이터 없음)', () => {
    const h = outputHealth(mkLat({ audio: q(null, null, 0), total: q(null, null, 0) }), null, NOW);
    expect(item(h, 'audio').level).toBe('idle');
    expect(item(h, 'audio').basis).toMatch(/^데이터 없음/);
    expect(h.headline).toBeNull();
  });

  it('오디오 base·output latency를 표시한다(없으면 데이터 없음)', () => {
    const on = outputHealth(mkLat(), { baseMs: 5.33, outputMs: 12 }, NOW);
    expect(item(on, 'audioLatency').value).toBe('5.3 · 12.0');
    expect(item(outputHealth(mkLat(), null, NOW), 'audioLatency').basis).toMatch(/^데이터 없음/);
  });

  it('대표 숫자는 판정→오디오 p95', () => {
    expect(outputHealth(mkLat({ audio: q(3, 8.26) }), null, NOW).headline).toEqual({ value: '8.3', unit: 'ms p95' });
  });

  it('데이터 없음 idle, 10초 넘으면 idle과 경과 이유', () => {
    const none = outputHealth(
      mkLat({ recv: q(null, null, 0), resolve: q(null, null, 0), audio: q(null, null, 0), total: q(null, null, 0), lastT: null }),
      null,
      NOW,
    );
    expect(none.level).toBe('idle');
    expect(none.reason).toBe('데이터 없음');
    const stale = outputHealth(mkLat({ lastT: NOW - T.validMs - 1 }), null, NOW);
    expect(stale.level).toBe('idle');
    expect(stale.reason).toMatch(/초 전 마지막 데이터$/);
  });
});

describe('keyMetrics', () => {
  const syncs = (stickIdx: 0 | 1, rtts: number[]): SyncSample[] =>
    rtts.map((rttMs, i) => ({ t: NOW - (rtts.length - i) * 1000, stick: stickIdx, t0: 0, t1Ms: 0, rttMs, offsetObsMs: 0 }));
  const snap = (over: Partial<HealthInput> = {}, stats: Partial<MonitorStats> = {}) => mkSnap({ stats: mkStats(stats), ...over });

  it('스틱에서 받은 게 없으면 전 항목 –와 "스틱 없음"', () => {
    const [l, r] = keyMetrics(snap(), NOW);
    for (const m of [l.rttLast, l.arrival, l.hitLoss, l.rate, r.rttMedian]) expect(m).toMatchObject({ value: '–', level: 'idle', why: '스틱 없음' });
  });

  it('스틱이 있으나 동기화 전이면 SYNC·도착은 "동기화 전", 패킷/초는 값', () => {
    const rows = [row(NOW - 100, 'pose'), row(NOW - 50, 'pose')];
    const [l, r] = keyMetrics(snap({ rows }), NOW);
    expect(l.rate).toMatchObject({ value: '2', level: 'idle' });
    expect(l.rttLast).toMatchObject({ value: '–', why: '동기화 전' });
    expect(l.arrival.why).toBe('동기화 전');
    expect(r.rate.why).toBe('스틱 없음');
  });

  it('SYNC 왕복 최근·중앙값과 25ms 경계, 도착·유실 색', () => {
    const [l, r] = keyMetrics(
      snap(
        { offsets: [0, 0] },
        {
          sync: { samples: [...syncs(0, [10, 12, 14]), ...syncs(1, [30, 30, 30])], adopted: [], lastLagMs: null, count: 6, unmatched: 0 },
          perStick: [
            stick({ hitCount: 4, hitFuture: { median: 5, max: 6, min: 4 }, hitLoss1m: 0 }),
            stick({ hitCount: 4, hitFuture: { median: -5, max: -3, min: -8 }, hitLoss1m: 2 }),
          ],
        },
      ),
      NOW,
    );
    expect(l.rttLast).toMatchObject({ value: '14.0', level: 'ok' });
    expect(l.rttMedian).toMatchObject({ value: '12.0', level: 'ok' });
    expect(l.arrival).toMatchObject({ value: '-5.0', level: 'ok' });
    expect(l.hitLoss).toMatchObject({ value: '0', level: 'ok' });
    expect(r.rttLast.level).toBe('warn');
    expect(r.arrival).toMatchObject({ value: '5.0', level: 'warn' });
    expect(r.hitLoss).toMatchObject({ value: '2', level: 'warn' });
  });

  it('도착 중앙값은 futureMs 중앙값의 부호 반대(future +5 → 도착 −5, ok)', () => {
    const [l] = keyMetrics(snap({ offsets: [0, 0] }, { perStick: [stick({ hitCount: 1, hitFuture: { median: 5, max: 6, min: 4 } }), stick()] }), NOW);
    expect(l.arrival).toMatchObject({ value: '-5.0', level: 'ok' });
  });

  it('수신 패킷/초는 스틱별 1초 창만 센다', () => {
    const rows = [row(NOW - 1500, 'pose'), row(NOW - 900, 'pose'), row(NOW - 10, 'hit', {})];
    const [l] = keyMetrics(snap({ rows }), NOW);
    expect(l.rate.value).toBe('2');
  });
});
