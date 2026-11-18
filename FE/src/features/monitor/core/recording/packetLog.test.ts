import { beforeEach, describe, expect, it } from 'vitest';
import type { PacketRecord } from '@/input/packetTap';
import { encodeSetPadTable, type PadTableEntry } from '@/input/stickProtocol';
import { buildBridgeStats, buildHit, buildLog, buildParamAck, buildPedal, buildPose, buildStatus, buildSyncAck } from '@/features/monitor/core/mockStick';
import { PacketLog } from './packetLog';
import { WRAP_MS, WRAP_US } from '@/features/monitor/core/tsUnwrap';

let log: PacketLog;
let nextId: number;

const rec = (bytes: Uint8Array, t: number, over: Partial<PacketRecord> = {}): PacketRecord => ({
  id: nextId++,
  dir: 'in',
  transport: 'mock',
  stickId: null,
  bytes,
  recvTime: t,
  ...over,
});

const hit = (seq: number, t: number, role: 0 | 1 = 0, timestampUs = 1_000_000) =>
  rec(buildHit({ role, seq, timestampUs, pad: 2, peakSpeedDps: 600 }), t);

beforeEach(() => {
  log = new PacketLog();
  nextId = 1;
});

describe('PacketLog 행 생성', () => {
  it('stick은 stickId 우선, 없으면 role 하위 비트', () => {
    log.ingest(hit(1, 0, 1));
    log.ingest(rec(buildHit({ role: 0, seq: 2, timestampUs: 0, pad: 0 }), 1, { stickId: 1 }));
    log.ingest(rec(buildBridgeStats({ okFrames: 1, crcErrors: 0, resyncCount: 0 }), 2));
    const rows = log.rows();
    expect(rows[0].stick).toBe(1);
    expect(rows[1].stick).toBe(1);
    expect(rows[2].stick).toBeNull();
  });

  it('role은 IN 패킷의 flags role, role 없는 패킷·OUT은 null', () => {
    log.ingest(hit(1, 0, 1));
    log.ingest(rec(buildBridgeStats({ okFrames: 1, crcErrors: 0, resyncCount: 0 }), 1));
    log.ingest(rec(new Uint8Array([0x10, 1, 0, 0, 0]), 2, { dir: 'out' }));
    expect(log.rows().map((r) => r.role)).toEqual([1, null, null]);
  });

  it('페달(role 2·3) 패킷은 stick null·role 그대로이고 손 통계에 들어가지 않는다', () => {
    log.ingest(rec(buildHit({ role: 2, seq: 1, timestampUs: 1_000_000, pad: 0 }), 0));
    log.ingest(rec(buildStatus({ role: 3, batteryPct: 50, rssi: -60, fwMajor: 1, fwMinor: 0 }), 1));
    log.ingest(rec(buildPedal(2, 1, 2_000_000), 2));
    const rows = log.rows();
    expect(rows.map((r) => r.stick)).toEqual([null, null, null]);
    expect(rows.map((r) => r.role)).toEqual([2, 3, 2]);
    // 페달 HIT는 손 시각 펼치기에 넣지 않는다
    expect(rows[0].tBrowser).toBeNull();
    const s = log.stats(3);
    expect(s.perStick[0].hitCount).toBe(0);
    expect(s.perStick[1].hitCount).toBe(0);
    expect(s.perStick[1].lastStatus).toBeNull();
  });

  it('out 레코드는 decoded null, outType은 첫 바이트', () => {
    log.ingest(rec(new Uint8Array([0x10, 1, 0, 0, 0]), 5, { dir: 'out' }));
    const r = log.rows()[0];
    expect(r.decoded).toBeNull();
    expect(r.outType).toBe(0x10);
    expect(log.stats(5).ratePerType.out).toBe(1);
  });

  it('길이 19 HIT는 error 행이고 errorCount가 오른다', () => {
    log.ingest(rec(buildHit({ seq: 1, timestampUs: 0, pad: 0 }).slice(0, 19), 0));
    expect(log.rows()[0].decoded?.kind).toBe('error');
    expect(log.stats(0).errorCount).toBe(1);
  });

  it('링버퍼는 capacity를 넘지 않고 version이 오른다', () => {
    const small = new PacketLog(5);
    for (let i = 0; i < 8; i++) small.ingest(hit(i, i));
    expect(small.rows().length).toBe(5);
    expect(small.version).toBe(8);
    expect(small.rows()[0].id).toBe(4);
    small.clear();
    expect(small.rows().length).toBe(0);
  });

  it('POSE는 별도 링이라 HIT·송신 행을 밀어내지 않고, rows()는 id 순으로 합친다', () => {
    const small = new PacketLog(5);
    small.ingest(hit(1, 1));
    for (let i = 0; i < 20; i++) small.ingest(rec(buildPose({ timestampUs: 0, elevationDeg: 0, azimuthDeg: 0, rollDeg: 0, seq: i }), 10 + i));
    small.ingest(hit(2, 40));
    const rows = small.rows();
    expect(rows.length).toBe(7);
    expect(rows.filter((r) => r.decoded?.kind === 'hit').map((r) => r.decoded?.kind === 'hit' && r.decoded.seq)).toEqual([1, 2]);
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort((a, b) => a - b));
    expect(small.recent('pose', 10).length).toBe(5);
  });

  it('recent는 종류별 최근 n건을 오래된 순으로 돌려준다', () => {
    for (let i = 0; i < 5; i++) log.ingest(hit(i, i));
    log.ingest(rec(buildPose({ timestampUs: 0, elevationDeg: 0, azimuthDeg: 0, rollDeg: 0, seq: 1 }), 6));
    expect(log.recent('hit', 3).map((r) => r.id)).toEqual([3, 4, 5]);
    expect(log.recent('pose', 3).length).toBe(1);
  });

  it('구독자에게 알린다', () => {
    let n = 0;
    const off = log.subscribe(() => n++);
    log.ingest(hit(1, 0));
    off();
    log.ingest(hit(2, 1));
    expect(n).toBe(1);
  });
});

describe('시각 펼치기·미래 ms', () => {
  it('오프셋이 없으면 null, 있으면 futureMs 계산, 랩 뒤에도 단조 증가', () => {
    log.ingest(hit(1, 0, 0, 0xfffffe00));
    expect(log.rows()[0].tBrowser).toBeNull();

    log.configure({ clockOffsetOf: () => 100 });
    log.ingest(hit(2, 1000, 0, 0xffffff00));
    log.ingest(hit(3, 1100, 0, 0x100));
    const [, a, b] = log.rows();
    // 바퀴 수를 세지 않고 수신 시각(1000·1100)에 가장 가까운 바퀴로 맞춘다
    expect(a.tBrowser).toBeCloseTo(0xffffff00 / 1000 + 100 - WRAP_MS);
    expect(b.tBrowser).toBeCloseTo(0x100 / 1000 + 100);
    expect(b.tBrowser as number).toBeGreaterThan(a.tBrowser as number);
    expect(a.futureMs).toBeCloseTo((a.tBrowser as number) - 1000);
  });

  it('랩 뒤에 소스 시계만 초기화돼도 수신−정지가 한 바퀴만큼 튀지 않는다', () => {
    // 랩 2초 전의 센서 시각이 브라우저 10000. 타격은 5ms 뒤 도착
    const base = WRAP_US - 2_000_000;
    let offset = 10_000 - base / 1000;
    log.configure({ clockOffsetOf: () => offset });
    log.ingest(hit(1, 10_005, 0, base));
    // 랩을 넘은 타격(센서 1초 = 브라우저 13000)
    log.ingest(hit(2, 13_005, 0, 1_000_000));
    // 스틱 재연결로 소스 ClockSync가 초기화되면 새 오프셋은 한 바퀴만큼 커진다
    offset += WRAP_MS;
    log.ingest(hit(3, 14_005, 0, 2_000_000));
    for (const r of log.rows()) expect(r.futureMs).toBeCloseTo(-5, 6);
    expect(log.stats(14_010).perStick[0].hitFuture.median).toBeCloseTo(-5, 6);
  });

  it('랩 뒤에 모니터 로그만 지워도 수신−정지가 튀지 않는다', () => {
    const base = WRAP_US - 2_000_000;
    const offset = 10_000 - base / 1000; // 소스는 랩 전 기준 오프셋을 그대로 쓴다
    log.configure({ clockOffsetOf: () => offset });
    log.ingest(hit(1, 10_005, 0, base));
    log.clear();
    log.ingest(hit(2, 13_005, 0, 1_000_000));
    expect(log.rows()[0].futureMs).toBeCloseTo(-5, 6);
  });

  it('hitFuture는 중앙값·최대·최소를 낸다', () => {
    log.configure({ clockOffsetOf: () => 0 });
    // timestampUs 1000·3000·5000 → tBrowser 1·3·5ms, recvTime 0 → future 1·3·5
    for (const [i, us] of [1000, 3000, 5000].entries()) log.ingest(hit(i, 0, 0, us));
    const s = log.stats(0).perStick[0];
    expect(s.hitFuture).toEqual({ median: 3, max: 5, min: 1 });
  });
});

describe('seq 유실', () => {
  it('HIT seq 1,2,4 → 유실 1', () => {
    log.ingest(hit(1, 0));
    log.ingest(hit(2, 10));
    log.ingest(hit(4, 20));
    const s = log.stats(20).perStick[0];
    expect(s.hitSeqLoss).toEqual({ window: 1, total: 1 });
    expect(s.hitCount).toBe(3);
    expect(s.lastHitT).toBe(20);
  });

  it('HIT 유실은 최근 1분 건수(hitLoss1m)로도 센다', () => {
    log.ingest(hit(1, 0));
    log.ingest(hit(4, 10)); // 유실 2
    expect(log.stats(1000).perStick[0].hitLoss1m).toBe(2);
    expect(log.stats(59_000).perStick[0].hitLoss1m).toBe(2);
    expect(log.stats(61_000).perStick[0].hitLoss1m).toBe(0);
  });

  it('seq 255 → 0은 유실 아님, 1초 창 밖은 window에서 빠진다', () => {
    log.ingest(hit(255, 0));
    log.ingest(hit(0, 10));
    log.ingest(hit(5, 20));
    expect(log.stats(20).perStick[0].hitSeqLoss.window).toBe(4);
    const later = log.stats(1500).perStick[0].hitSeqLoss;
    expect(later).toEqual({ window: 0, total: 4 });
  });

  it('POSE 13B는 유실률을 내고 12B는 pct null', () => {
    const pose = (seq: number | null, t: number) =>
      rec(buildPose({ timestampUs: 0, elevationDeg: 0, azimuthDeg: 0, rollDeg: 0, seq }), t);
    log.ingest(pose(1, 0));
    log.ingest(pose(2, 10));
    log.ingest(pose(5, 20)); // 유실 2, 수신 3 → 2/5
    const s = log.stats(20).perStick[0].poseSeqLoss;
    expect(s.window).toBe(2);
    expect(s.total).toBe(2);
    expect(s.pct).toBeCloseTo(40);

    const log2 = new PacketLog();
    log2.ingest(pose(null, 0));
    log2.ingest(pose(null, 10));
    expect(log2.stats(10).perStick[0].poseSeqLoss.pct).toBeNull();
  });

  it('스틱별로 분리 집계', () => {
    log.ingest(hit(1, 0, 0));
    log.ingest(hit(1, 0, 1));
    log.ingest(hit(3, 1, 1));
    const st = log.stats(1).perStick;
    expect(st[0].hitSeqLoss.total).toBe(0);
    expect(st[1].hitSeqLoss.total).toBe(1);
  });
});

describe('레이트·STATUS', () => {
  it('ratePerType은 최근 1초만 센다', () => {
    log.ingest(hit(1, 0));
    log.ingest(hit(2, 900));
    log.ingest(rec(buildStatus({ batteryPct: null, rssi: -60, fwMajor: 0, fwMinor: 1 }), 950));
    expect(log.stats(1000).ratePerType).toEqual({ hit: 2, status: 1 });
    expect(log.stats(1500).ratePerType).toEqual({ hit: 1, status: 1 });
    expect(log.stats(2500).ratePerType).toEqual({});
    expect(log.stats(2500).total).toBe(3);
  });

  it('STATUS 경과와 마지막 값', () => {
    expect(log.stats(0).perStick[0].statusAgeMs).toBeNull();
    log.ingest(rec(buildStatus({ batteryPct: 80, rssi: -50, fwMajor: 1, fwMinor: 2 }), 100));
    const s = log.stats(600).perStick[0];
    expect(s.statusAgeMs).toBe(500);
    expect(s.lastStatus?.batteryPct).toBe(80);
  });
});

describe('브리지', () => {
  it('델타와 stalled', () => {
    log.ingest(rec(buildBridgeStats({ okFrames: 10, crcErrors: 0, resyncCount: 0 }), 0));
    log.ingest(rec(buildBridgeStats({ okFrames: 110, crcErrors: 2, resyncCount: 1 }), 1000));
    const s = log.stats(1000).bridge;
    expect(s.delta1s).toEqual({ okFrames: 100, crcErrors: 2, resyncCount: 1 });
    expect(s.last?.okFrames).toBe(110);
    expect(s.ageMs).toBe(0);
    expect(s.stalled).toBe(false);
    expect(log.stats(4500).bridge.stalled).toBe(true);
    expect(log.stats(4500).bridge.delta1s).toEqual({ okFrames: 0, crcErrors: 0, resyncCount: 0 });
  });

  it('수신 전에는 age null', () => {
    const b = log.stats(0).bridge;
    expect(b.ageMs).toBeNull();
    expect(b.stalled).toBe(false);
  });
});

describe('LOG 집계', () => {
  it('drop·BOOT·I2C', () => {
    log.ingest(rec(buildLog('BOOT 0.1 abc'), 0));
    log.ingest(rec(buildLog('drop weak 320'), 100));
    log.ingest(rec(buildLog('drop weak 300'), 200));
    log.ingest(rec(buildLog('drop slow 512'), 1300));
    log.ingest(rec(buildLog('I2C REC 2'), 1300));
    log.ingest(rec(buildLog('hello'), 1300));
    const s = log.stats(1400);
    expect(s.build).toBe('BOOT 0.1 abc');
    expect(s.drops.weak).toEqual({ total: 2, window: 0 });
    expect(s.drops.slow).toEqual({ total: 1, window: 1 });
    expect(s.i2cRecoveries).toBe(2);
    expect(log.rows()[5].log?.kind).toBe('text');
    expect(log.rows()[1].log?.kind).toBe('drop');
  });

  it('drop short는 기존 drop으로 집계', () => {
    log.ingest(rec(buildLog('drop short 90'), 100));
    expect(log.stats(200).drops.short).toEqual({ total: 1, window: 1 });
  });

  it('BIAS·IMU FAIL은 스틱별 마지막 값, 다음 BOOT에서 초기화', () => {
    log.ingest(rec(buildLog('BIAS 12 -3 5', 0), 0));
    log.ingest(rec(buildLog('BIAS default', 1), 1));
    log.ingest(rec(buildLog('IMU FAIL', 1), 2));
    let s = log.stats(10);
    expect(s.perStick[0]).toMatchObject({ bias: 'measured', imuFail: false });
    expect(s.perStick[1]).toMatchObject({ bias: 'default', imuFail: true });
    log.ingest(rec(buildLog('BOOT 1.0 nrf52', 1), 20));
    s = log.stats(30);
    expect(s.perStick[0].bias).toBe('measured');
    expect(s.perStick[1]).toMatchObject({ bias: null, imuFail: false });
  });
});

describe('SYNC 왕복 표본', () => {
  /** 송신 SYNC. 바이트의 t0는 floor(t). tPublish를 주면 publish 시각만 그만큼 늦춘다(소스가 t0를 찍고 publish까지 걸린 시간) */
  const out = (t: number, tPublish = t) => {
    const bytes = new Uint8Array(5);
    bytes[0] = 0x10;
    new DataView(bytes.buffer).setUint32(1, Math.floor(t) >>> 0, true);
    return rec(bytes, tPublish, { dir: 'out' });
  };
  const ack = (t0Ms: number, t1Us: number, t: number, role: 0 | 1 = 0) => rec(buildSyncAck({ role, t0Ms, t1Us }), t);

  it('관측 오프셋 = (t0+t2)/2 − t1, rtt = t2 − t0', () => {
    log.ingest(out(100.4));
    log.ingest(ack(100, 5000, 110.4));
    const s = log.stats(111).sync;
    expect(s.samples).toHaveLength(1);
    expect(s.samples[0]).toMatchObject({ t: 110.4, stick: 0, t0: 100.4, t1Ms: 5, rttMs: 10 });
    expect(s.samples[0].offsetObsMs).toBeCloseTo((100.4 + 110.4) / 2 - 5, 9);
    expect(s.lastLagMs).toBe(10);
    expect(s.count).toBe(1);
    expect(s.unmatched).toBe(0);
  });

  it('ACK 순서가 바뀌어도 t0Ms로 짝이 맞는다', () => {
    log.ingest(out(100));
    log.ingest(out(200));
    log.ingest(ack(200, 0, 207));
    log.ingest(ack(100, 0, 103));
    const rtts = log.stats(210).sync.samples.map((x) => [x.t0, x.rttMs]);
    expect(rtts).toEqual([
      [200, 7],
      [100, 3],
    ]);
  });

  it('ACK 1건이 유실돼도 이후 짝이 밀리지 않는다(FIFO 아님)', () => {
    log.ingest(out(100));
    log.ingest(out(200));
    log.ingest(out(300));
    log.ingest(ack(100, 0, 104));
    // 200의 ACK 유실
    log.ingest(ack(300, 0, 309));
    const s = log.stats(310).sync;
    expect(s.samples.map((x) => [x.t0, x.rttMs])).toEqual([
      [100, 4],
      [300, 9],
    ]);
    expect(s.unmatched).toBe(0);
  });

  it('같은 ms에 보낸 SYNC 2건은 가장 오래된 것부터 짝짓는다', () => {
    log.ingest(out(100.1));
    log.ingest(out(100.7));
    log.ingest(ack(100, 0, 110));
    log.ingest(ack(100, 0, 120));
    expect(log.stats(121).sync.samples.map((x) => x.t0)).toEqual([100.1, 100.7]);
  });

  it('짝이 없는 ACK는 표본에서 빼고 unmatched만 올린다(FIFO 폴백 없음)', () => {
    log.ingest(out(100));
    log.ingest(ack(999, 0, 105));
    const s = log.stats(106).sync;
    expect(s.samples).toHaveLength(0);
    expect(s.unmatched).toBe(1);
    expect(s.count).toBe(1);
    // 짝 못 찾은 pending은 그대로 남아 제대로 된 ACK가 오면 짝지어진다
    log.ingest(ack(100, 0, 108));
    expect(log.stats(109).sync.samples).toHaveLength(1);
  });

  it('SYNC 1건에 L·R ACK 각 1건 → 표본 2건(스틱별), unmatched 0', () => {
    log.ingest(out(100));
    log.ingest(ack(100, 5000, 104, 0));
    log.ingest(ack(100, 5000, 108, 1));
    const s = log.stats(109).sync;
    expect(s.samples.map((x) => [x.stick, x.rttMs])).toEqual([
      [0, 4],
      [1, 8],
    ]);
    expect(s.unmatched).toBe(0);
  });

  it('같은 스틱의 중복 ACK는 unmatched', () => {
    log.ingest(out(100));
    log.ingest(ack(100, 0, 104, 0));
    log.ingest(ack(100, 0, 106, 0));
    const s = log.stats(107).sync;
    expect(s.samples).toHaveLength(1);
    expect(s.unmatched).toBe(1);
  });

  it('t0를 찍은 뒤 publish가 ms 경계를 넘어도(Serial writeChain) 바이트의 t0로 짝이 맞는다', () => {
    // 소스는 t0=100.9로 바이트를 만들고 3.5ms 뒤에 publish. floor(publish)=104 ≠ t0Ms=100
    log.ingest(out(100.9, 104.4));
    log.ingest(ack(100, 0, 112.4));
    const s = log.stats(113).sync;
    expect(s.samples).toHaveLength(1);
    expect(s.unmatched).toBe(0);
    // rtt·오프셋의 t0는 publish 시각(실제 송신에 가까운 쪽)
    expect(s.samples[0].t0).toBe(104.4);
    expect(s.samples[0].rttMs).toBeCloseTo(8, 9);
  });

  it('pending은 2초 지나면 버린다', () => {
    log.ingest(out(100));
    log.ingest(ack(100, 0, 2200));
    const s = log.stats(2201).sync;
    expect(s.samples).toHaveLength(0);
    expect(s.unmatched).toBe(1);
  });

  it('스틱 시계 u32 랩 전후에도 관측 오프셋이 연속이다', () => {
    // 스틱 시계 = 브라우저 시계 + 1000ms 뒤처짐. 랩 직전부터 직후까지 5회
    const base = WRAP_US - 2_000_000;
    for (let i = 0; i < 5; i++) {
      const t0 = 1000 + i * 1000;
      const t2 = t0 + 4;
      const stickMs = t0 + 2 - 1000 + base / 1000;
      log.ingest(out(t0));
      log.ingest(ack(t0, (stickMs * 1000) % WRAP_US, t2));
    }
    const offs = log.stats(7000).sync.samples.map((x) => x.offsetObsMs);
    expect(offs).toHaveLength(5);
    for (const o of offs) expect(Math.abs(o - offs[0])).toBeLessThan(1e-6);
  });

  it('samples는 최근 600개만 보관한다', () => {
    for (let i = 0; i < 605; i++) {
      log.ingest(out(i * 10));
      log.ingest(ack(i * 10, 0, i * 10 + 1));
    }
    const s = log.stats(0).sync;
    expect(s.samples).toHaveLength(600);
    expect(s.samples[0].t0).toBe(50);
  });

  it('페달(role 2) ACK는 손 표본이 아니다', () => {
    log.ingest(out(100));
    log.ingest(rec(buildSyncAck({ role: 2, t0Ms: 100, t1Us: 0 }), 105));
    expect(log.stats(106).sync.samples).toHaveLength(0);
  });

  it('양손·두 페달이 모두 답해도 짝 실패는 0건이고 ACK 수는 손 것만 센다', () => {
    for (let i = 0; i < 4; i++) {
      const t0 = 1000 + i * 1000;
      log.ingest(out(t0));
      log.ingest(ack(t0, t0 * 1000, t0 + 4, 0));
      log.ingest(ack(t0, t0 * 1000, t0 + 5, 1));
      log.ingest(rec(buildSyncAck({ role: 2, t0Ms: t0, t1Us: t0 * 1000 }), t0 + 6));
      log.ingest(rec(buildSyncAck({ role: 3, t0Ms: t0, t1Us: t0 * 1000 }), t0 + 6));
    }
    const s = log.stats(5000);
    expect(s.sync.count).toBe(8);
    expect(s.sync.unmatched).toBe(0);
    expect(s.sync.samples).toHaveLength(8);
  });

  it('페달 SYNC는 페달 칸에 따로 세고 role 2 응답만 쓴다', () => {
    expect(log.stats(0).pedal.present).toBe(false);
    log.ingest(out(1000));
    log.ingest(rec(buildSyncAck({ role: 2, t0Ms: 1000, t1Us: 400_000 }), 1008));
    log.ingest(rec(buildSyncAck({ role: 3, t0Ms: 1000, t1Us: 400_000 }), 1008));
    log.ingest(out(2000));
    log.ingest(rec(buildSyncAck({ role: 2, t0Ms: 2000, t1Us: 1_400_000 }), 2006));
    // 짝이 없는 페달 ACK
    log.ingest(rec(buildSyncAck({ role: 2, t0Ms: 777, t1Us: 0 }), 2100));
    log.ingest(rec(buildStatus({ role: 3, batteryPct: 80, rssi: -55, fwMajor: 3, fwMinor: 1 }), 2200));
    const p = log.stats(2300).pedal;
    expect(p.present).toBe(true);
    expect(p.sync).toEqual({ count: 3, unmatched: 1, lastRttMs: 6, minRttMs: 6, offsetObsMs: 2003 - 1400 });
    expect(p.lastStatus[0]).toBeNull();
    expect(p.lastStatus[1]).toMatchObject({ batteryPct: 80, fwMajor: 3, fwMinor: 1 });
    expect(p.statusAgeMs).toEqual([null, 100]);
    // 손 통계에는 들어가지 않는다
    const s = log.stats(2300);
    expect(s.sync.count).toBe(0);
    expect(s.sync.unmatched).toBe(0);
    log.clear();
    expect(log.stats(0).pedal.present).toBe(false);
    expect(log.stats(0).pedal.sync.count).toBe(0);
  });

  it('role 1 ACK는 stick 1 표본', () => {
    log.ingest(out(100));
    log.ingest(ack(100, 0, 105, 1));
    expect(log.stats(106).sync.samples[0].stick).toBe(1);
  });
});

describe('채택 오프셋 기록', () => {
  it('값이 바뀔 때만 추가하고 null은 무시한다', () => {
    log.noteAdoptedOffsets(10, [null, null]);
    log.noteAdoptedOffsets(20, [5, null]);
    log.noteAdoptedOffsets(30, [5, 7]);
    log.noteAdoptedOffsets(40, [4.5, 7]);
    log.noteAdoptedOffsets(50, [null, 7]);
    expect(log.stats(60).sync.adopted).toEqual([
      { t: 20, stick: 0, offsetMs: 5 },
      { t: 30, stick: 1, offsetMs: 7 },
      { t: 40, stick: 0, offsetMs: 4.5 },
    ]);
  });

  it('0.5ms 미만의 움직임은 변화점으로 남기지 않는다', () => {
    log.noteAdoptedOffsets(10, [100, null]);
    log.noteAdoptedOffsets(20, [100.2, null]);
    log.noteAdoptedOffsets(30, [100.4, null]);
    log.noteAdoptedOffsets(40, [100.6, null]);
    expect(log.stats(50).sync.adopted).toEqual([
      { t: 10, stick: 0, offsetMs: 100 },
      { t: 40, stick: 0, offsetMs: 100.6 },
    ]);
  });

  it('소스 오프셋이 한 바퀴 뛰어도(랩 뒤 초기화) 채택·관측 오프셋이 튀지 않는다', () => {
    log.noteAdoptedOffsets(10, [1000, null]);
    log.noteAdoptedOffsets(20, [1000.2 + WRAP_MS, null]);
    log.noteAdoptedOffsets(30, [1003 + WRAP_MS, null]);
    const a = log.stats(40).sync.adopted;
    expect(a).toHaveLength(2);
    expect(a[0].offsetMs).toBe(1000);
    expect(a[1].offsetMs).toBeCloseTo(1003, 6);
  });

  it('최근 200개만 보관하고 clear로 비운다', () => {
    for (let i = 0; i < 205; i++) log.noteAdoptedOffsets(i, [i, null]);
    const a = log.stats(0).sync.adopted;
    expect(a).toHaveLength(200);
    expect(a[0].t).toBe(5);
    log.clear();
    expect(log.stats(0).sync.adopted).toHaveLength(0);
    log.noteAdoptedOffsets(1, [204, null]);
    expect(log.stats(0).sync.adopted).toHaveLength(1);
  });
});

describe('start·stop', () => {
  it('paramAck도 행으로 남는다', () => {
    log.ingest(rec(buildParamAck({ paramId: 0x20, value: 7 }), 0));
    expect(log.rows()[0].decoded).toMatchObject({ kind: 'paramAck', paramId: 0x20, value: 7 });
  });
});

describe('송신 SET_PAD_TABLE 표 복원', () => {
  const entry = (pad: PadTableEntry['pad'], radiusDeg = 10): PadTableEntry => ({ pad, elevationDeg: 5, azimuthDeg: -10, radiusDeg });
  const send = (entries: PadTableEntry[], clearFirst: boolean, t = 0) => {
    for (const p of encodeSetPadTable(entries, clearFirst)) log.ingest(rec(p, t, { dir: 'out' }));
  };
  const pads = ['SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'CRASH', 'HIHAT'] as const;

  it('clear 후 3+3+1 엔트리 3패킷 → 7개, 마지막 수신 시각', () => {
    expect(log.stats(0).padTable).toEqual({ entries: [], t: null });
    send(pads.map((p) => entry(p)), true, 42);
    const t = log.stats(50).padTable;
    expect(t.entries.map((e) => e.pad)).toEqual([...pads]);
    expect(t.t).toBe(42);
  });

  it('같은 pad 재전송은 교체한다', () => {
    send(pads.map((p) => entry(p)), true);
    send([entry('SNARE', 20)], false);
    const t = log.stats(0).padTable.entries;
    expect(t).toHaveLength(7);
    expect(t.find((e) => e.pad === 'SNARE')?.radiusDeg).toBe(20);
  });

  it('clear 패킷은 표를 비우고, 링버퍼에서 밀려나도 표는 유지된다', () => {
    const small = new PacketLog(3);
    for (const p of encodeSetPadTable([entry('SNARE')], true)) small.ingest(rec(p, 0, { dir: 'out' }));
    for (let i = 0; i < 6; i++) small.ingest(hit(i, i + 1));
    expect(small.stats(10).padTable.entries).toHaveLength(1);
    for (const p of encodeSetPadTable([], true)) small.ingest(rec(p, 20, { dir: 'out' }));
    expect(small.stats(20).padTable.entries).toHaveLength(0);
  });
});
