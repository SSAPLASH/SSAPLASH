// 패킷 로그. packetTap 레코드를 디코드해 링버퍼에 쌓고, 1초 창 통계(MonitorStats)를 계산한다.
// 원시 센서 시각을 수신 시각에 가장 가까운 바퀴로 환산해 tBrowser·futureMs를 채운다(바퀴 수를 세지 않음). 타이머는 만들지 않는다 — stats() 호출 주기는 화면이 정한다.
import type { PacketRecord } from '@/input/packetTap';
import { packetTap } from '@/input/packetTap';
import {
  decodePacket,
  decodeSetPadTable,
  type PadTableEntry,
  type DecodedBridgeStats,
  type DecodedPacket,
  type DecodedStatus,
  CommandType,
  handOf,
} from '@/input/stickProtocol';
import { parseLogText, type ParsedLog } from './logParse';
import { SyncPairer, syncKeyOf } from '@/features/monitor/core/syncPair';
import { futureMs, nearBrowserMs, normalizeOffsetMs } from '@/features/monitor/core/tsUnwrap';
import { median } from '@/features/monitor/core/syncTrend';

/** SYNC 왕복 1회. t0 = 송신(out 0x10), t1Ms = 스틱 시계(펼친 µs → ms), t2 = SYNC_ACK 수신 */
export interface SyncSample {
  /** t2(수신 시각) */
  t: number;
  stick: 0 | 1;
  t0: number;
  t1Ms: number;
  rttMs: number;
  /** (t0 + t2) / 2 − t1Ms. 브라우저 시계 − 스틱 시계 */
  offsetObsMs: number;
}

export interface LogRow {
  id: number;
  /** 수신(송신) 시각 performance.now() */
  t: number;
  dir: 'in' | 'out';
  transport: PacketRecord['transport'];
  /** 손(role 0·1)만. 페달(role 2·3)·손을 모르는 줄은 null */
  stick: 0 | 1 | null;
  /** IN 패킷의 flags role(0 왼손, 1 오른손, 2·3 페달). role이 없는 패킷·OUT은 null */
  role: number | null;
  bytes: Uint8Array;
  /** out이면 null */
  decoded: DecodedPacket | null;
  /** out이면 bytes[0] */
  outType: number | null;
  tBrowser: number | null;
  /** HIT·POSE만 */
  futureMs: number | null;
  /** LOG만 */
  log: ParsedLog | null;
}

export interface StickStats {
  hitSeqLoss: { window: number; total: number };
  poseSeqLoss: { window: number; total: number; pct: number | null };
  /** 최근 50건 */
  hitFuture: { median: number | null; max: number | null; min: number | null };
  /** 최근 1분(60초) HIT 유실 건수 */
  hitLoss1m: number;
  statusAgeMs: number | null;
  lastStatus: DecodedStatus | null;
  hitCount: number;
  lastHitT: number | null;
  /** 마지막 BIAS 로그 결과. 'default'는 부팅 때 흔들려 기본값으로 떨어진 경우. 다음 BOOT에서 null로 초기화 */
  bias: 'measured' | 'default' | null;
  /** IMU FAIL 로그를 받았는지. 다음 BOOT에서 초기화 */
  imuFail: boolean;
}

export interface MonitorStats {
  /** kind 문자열 키, 최근 1초 수신 개수. 송신은 'out' 키 */
  ratePerType: Record<string, number>;
  perStick: [StickStats, StickStats];
  bridge: {
    last: DecodedBridgeStats | null;
    delta1s: { okFrames: number; crcErrors: number; resyncCount: number };
    ageMs: number | null;
    /** ageMs > 3000 */
    stalled: boolean;
  };
  drops: Record<string, { total: number; window: number }>;
  i2cRecoveries: number | null;
  /** 마지막 BOOT 로그 원문 */
  build: string | null;
  sync: {
    samples: SyncSample[];
    /** ClockSync가 채택한 오프셋의 변화점 */
    adopted: { t: number; stick: 0 | 1; offsetMs: number }[];
    /** 마지막 표본의 rttMs */
    lastLagMs: number | null;
    /** 손(role 0·1) SYNC_ACK 수신 수(짝 실패 포함). 페달 ACK는 pedal.sync에 따로 센다 */
    count: number;
    /** t0Ms가 맞는 pending을 못 찾은 손 ACK 수 */
    unmatched: number;
  };
  /** 페달 보드(role 2·3). 손 통계와 섞지 않고 따로 둔다 */
  pedal: PedalStats;
  /** FE가 스틱에 보낸 SET_PAD_TABLE을 되읽어 복원한 "스틱이 가진 패드 표". 보낸 적 없으면 entries 비고 t null */
  padTable: { entries: PadTableEntry[]; t: number | null };
  errorCount: number;
  total: number;
}

/** 페달 보드 통계. 보드 하나가 role 2·3을 같은 시계로 보내므로 SYNC는 role 2 ACK만 센다(role 3은 같은 t0·t1의 중복) */
export interface PedalStats {
  /** role 2·3 패킷이 온 적이 있는지 */
  present: boolean;
  /** 마지막 STATUS [role 2, role 3] */
  lastStatus: [DecodedStatus | null, DecodedStatus | null];
  statusAgeMs: [number | null, number | null];
  sync: {
    count: number;
    unmatched: number;
    lastRttMs: number | null;
    minRttMs: number | null;
    /** 마지막 관측 오프셋(브라우저 시계 − 페달 시계, ms) */
    offsetObsMs: number | null;
  };
}

export interface PacketLogDeps {
  now?: () => number;
  clockOffsetOf?: (stick: 0 | 1) => number | null;
}

const WINDOW_MS = 1000;
const FUTURE_KEEP = 50;
const LOSS_KEEP_MS = 60_000;
const SYNC_KEEP = 600;
const ADOPTED_KEEP = 200;
/** 채택 오프셋이 직전 기록값과 이만큼(ms) 이상 달라야 변화점으로 남긴다. 적용 오프셋이 조금씩 움직여도 기록이 금방 차지 않게 한다 */
const ADOPTED_MIN_STEP_MS = 0.5;
const BRIDGE_STALL_MS = 3000;

interface SeqEvent {
  t: number;
  lost: number;
  /** POSE만: 이 패킷이 seq를 가졌는지 */
  hasSeq: boolean;
}

/** 스틱별 누적 상태 */
interface StickState {
  lastHitSeq: number | null;
  lastPoseSeq: number | null;
  hitLossTotal: number;
  poseLossTotal: number;
  hitEvents: SeqEvent[];
  /** 유실이 있었던 HIT만(최근 1분 집계용) */
  hitLossEvents: { t: number; lost: number }[];
  poseEvents: SeqEvent[];
  future: number[];
  lastStatus: { pkt: DecodedStatus; t: number } | null;
  hitCount: number;
  lastHitT: number | null;
  bias: StickStats['bias'];
  imuFail: boolean;
}

const freshStick = (): StickState => ({
  lastHitSeq: null,
  lastPoseSeq: null,
  hitLossTotal: 0,
  poseLossTotal: 0,
  hitEvents: [],
  hitLossEvents: [],
  poseEvents: [],
  future: [],
  lastStatus: null,
  hitCount: 0,
  lastHitT: null,
  bias: null,
  imuFail: false,
});

interface BridgeSample {
  t: number;
  okFrames: number;
  crcErrors: number;
  resyncCount: number;
}

/** 직전 seq 대비 유실 개수. 기대 = 이전+1 (mod 256) */
function seqLoss(prev: number | null, cur: number): number {
  if (prev === null) return 0;
  const diff = (cur - prev + 256) % 256;
  return Math.max(0, diff - 1);
}

const freshPedalSync = (): PedalStats['sync'] => ({ count: 0, unmatched: 0, lastRttMs: null, minRttMs: null, offsetObsMs: null });

export class PacketLog {
  /** 행 추가마다 +1. useSyncExternalStore 스냅샷으로 쓴다 */
  version = 0;
  readonly capacity: number;

  private deps: PacketLogDeps = {};
  /** POSE 행 링(초당 100건이라 나머지를 밀어내지 않게 분리) */
  private poseBuf: LogRow[] = [];
  /** POSE를 뺀 나머지 행 링(HIT·오류·LOG·송신 등). 각각 capacity까지 */
  private eventBuf: LogRow[] = [];
  /** rows()가 두 링을 id 순으로 합친 결과. version이 같으면 재사용 */
  private merged: { version: number; rows: LogRow[] } | null = null;
  private listeners = new Set<() => void>();
  private offTap: (() => void) | null = null;
  /** 오프셋 정규화 기준값(칸별로 처음 본 오프셋). 0·1 = 손, 2 = 페달 */
  private offsetRef: [number | null, number | null, number | null] = [null, null, null];
  private pedalStatus: [{ pkt: DecodedStatus; t: number } | null, { pkt: DecodedStatus; t: number } | null] = [null, null];
  private pedalPresent = false;
  private pedalSync: PedalStats['sync'] = freshPedalSync();

  private sticks: [StickState, StickState] = [freshStick(), freshStick()];
  private rateEvents: { t: number; key: string }[] = [];
  private bridgeSamples: BridgeSample[] = [];
  private lastBridge: { pkt: DecodedBridgeStats; t: number } | null = null;
  private dropTotals: Record<string, number> = {};
  private dropEvents: { t: number; reason: string }[] = [];
  private i2c: number | null = null;
  private build: string | null = null;
  /** 송신한 SYNC. t = publish 시각(rtt·오프셋의 t0), key = 바이트 안의 u32 t0(SYNC_ACK t0Ms와 짝 맞추는 키) */
  private pairer = new SyncPairer();
  private syncSamples: SyncSample[] = [];
  private adopted: { t: number; stick: 0 | 1; offsetMs: number }[] = [];
  private lastAdopted: [number | null, number | null] = [null, null];
  private syncCount = 0;
  private syncUnmatched = 0;
  /** 송신 SET_PAD_TABLE 누적 표. 링 버퍼에서 밀려나도 유지한다 */
  private padTable = new Map<PadTableEntry['pad'], PadTableEntry>();
  private padTableT: number | null = null;
  private errorCount = 0;
  private total = 0;

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  configure(deps: PacketLogDeps): void {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  /**
   * 구독 시작. 중복 호출은 무해하다. 기본은 packetTap, 모니터 페이지는 직접 연결·따라보기를 아우르는 feed 구독 함수를 넘긴다
   */
  start(subscribe: (fn: (rec: PacketRecord) => void) => () => void = (fn) => packetTap.subscribe(fn)): void {
    if (this.offTap) return;
    this.offTap = subscribe((rec) => this.ingest(rec));
  }

  stop(): void {
    this.offTap?.();
    this.offTap = null;
  }

  /** 레코드 한 건 처리. 테스트·모의에서 직접 불러도 된다 */
  ingest(rec: PacketRecord): void {
    const decoded = rec.dir === 'in' ? decodePacket(rec.bytes, rec.recvTime) : null;
    const role = decoded && 'role' in decoded ? decoded.role : null;
    // 페달(role 2·3)은 손이 아니다. stick을 비워 손 통계(SYNC 왕복·HIT 유실·오프셋)에 섞이지 않게 한다
    const stick: 0 | 1 | null = rec.stickId ?? (role !== null ? handOf(role) : null);

    let tBrowser: number | null = null;
    let future: number | null = null;
    let t1Ms: number | null = null;
    if (decoded && stick !== null && (decoded.kind === 'hit' || decoded.kind === 'pose' || decoded.kind === 'syncAck')) {
      const us = decoded.kind === 'syncAck' ? decoded.t1Us : decoded.timestampUs;
      // 바퀴 수를 세지 않고 수신 시각에 가장 가까운 바퀴로 맞춘다(소스 ClockSync와 초기화 시점이 달라도 어긋나지 않는다)
      tBrowser = nearBrowserMs(us, this.deps.clockOffsetOf ? this.deps.clockOffsetOf(stick) : null, rec.recvTime);
      if (decoded.kind === 'syncAck') t1Ms = us / 1000;
      if (decoded.kind !== 'syncAck') future = futureMs(tBrowser, rec.recvTime);
    } else if (decoded?.kind === 'syncAck' && role === 2) {
      t1Ms = decoded.t1Us / 1000;
    }
    if (role === 2 || role === 3) this.pedalPresent = true;

    const row: LogRow = {
      id: rec.id,
      t: rec.recvTime,
      dir: rec.dir,
      transport: rec.transport,
      stick,
      role,
      bytes: rec.bytes,
      decoded,
      outType: rec.dir === 'out' ? (rec.bytes.length ? rec.bytes[0] : null) : null,
      tBrowser,
      futureMs: future,
      log: decoded?.kind === 'log' ? parseLogText(decoded.text) : null,
    };

    const buf = decoded?.kind === 'pose' ? this.poseBuf : this.eventBuf;
    buf.push(row);
    if (buf.length > this.capacity) buf.shift();
    this.total++;
    this.rateEvents.push({ t: rec.recvTime, key: decoded ? decoded.kind : 'out' });
    this.updateStats(row, t1Ms);

    this.version++;
    for (const l of this.listeners) l();
  }

  private updateStats(row: LogRow, t1Ms: number | null): void {
    // 2초 넘은 pending은 유실 SYNC로 버린다
    this.pairer.expire(row.t);
    if (row.dir === 'out') {
      // 짝 키는 바이트 안의 u32 t0(펌웨어가 SYNC_ACK로 되돌려주는 값). publish 시각의 floor를 쓰면
      // 소스가 t0를 찍은 뒤 publish까지의 간격(Serial은 writeChain 대기로 수 ms)에 ms 경계를 넘어 어긋난다
      const syncKey = row.outType === CommandType.SYNC ? syncKeyOf(row.bytes) : null;
      if (syncKey !== null) {
        this.pairer.addOut(row.t, syncKey);
      } else if (row.outType === CommandType.SET_PAD_TABLE) {
        const pt = decodeSetPadTable(row.bytes);
        if (pt) {
          if (pt.clear) this.padTable.clear();
          for (const e of pt.entries) this.padTable.set(e.pad, e);
          this.padTableT = row.t;
        }
      }
      return;
    }
    const d = row.decoded;
    if (!d) return;
    const st = row.stick !== null ? this.sticks[row.stick] : null;
    switch (d.kind) {
      case 'error':
        this.errorCount++;
        break;
      case 'hit': {
        if (!st) break;
        const lost = seqLoss(st.lastHitSeq, d.seq);
        st.lastHitSeq = d.seq;
        st.hitLossTotal += lost;
        st.hitEvents.push({ t: row.t, lost, hasSeq: true });
        if (lost > 0) st.hitLossEvents.push({ t: row.t, lost });
        st.hitCount++;
        st.lastHitT = row.t;
        if (row.futureMs !== null) {
          st.future.push(row.futureMs);
          if (st.future.length > FUTURE_KEEP) st.future.shift();
        }
        break;
      }
      case 'pose': {
        if (!st) break;
        let lost = 0;
        if (d.seq !== null) {
          lost = seqLoss(st.lastPoseSeq, d.seq);
          st.lastPoseSeq = d.seq;
          st.poseLossTotal += lost;
        }
        st.poseEvents.push({ t: row.t, lost, hasSeq: d.seq !== null });
        break;
      }
      case 'status':
        if (st) st.lastStatus = { pkt: d, t: row.t };
        else if (row.role === 2 || row.role === 3) this.pedalStatus[row.role - 2] = { pkt: d, t: row.t };
        break;
      case 'bridgeStats':
        this.lastBridge = { pkt: d, t: row.t };
        this.bridgeSamples.push({ t: row.t, okFrames: d.okFrames, crcErrors: d.crcErrors, resyncCount: d.resyncCount });
        break;
      case 'syncAck': {
        // 되돌아온 t0Ms와 송신 바이트의 t0가 같고 이 칸이 아직 짝짓지 않은 pending 중 가장 오래된 것.
        // 못 찾으면 표본 제외(FIFO 폴백 없음). SYNC 1건에 기기마다 ACK가 오므로 pending은 짝지어도 2초 만료까지 둔다
        const stick = row.stick;
        if (stick === null) {
          // 페달 보드: role 2 ACK만 페달 칸에 센다. role 3은 같은 보드가 같은 t0·t1로 한 번 더 보낸 것이라 세지 않는다
          if (row.role !== 2) break;
          const ps = this.pedalSync;
          ps.count++;
          const pt0 = t1Ms === null ? null : this.pairer.match(d.t0Ms, 2);
          if (pt0 === null || t1Ms === null) {
            ps.unmatched++;
            break;
          }
          const rtt = row.t - pt0;
          ps.lastRttMs = rtt;
          ps.minRttMs = ps.minRttMs === null ? rtt : Math.min(ps.minRttMs, rtt);
          ps.offsetObsMs = this.normalized(2, (pt0 + row.t) / 2 - t1Ms);
          break;
        }
        this.syncCount++;
        const t0 = t1Ms === null ? null : this.pairer.match(d.t0Ms, stick);
        if (t0 === null || t1Ms === null) {
          this.syncUnmatched++;
          break;
        }
        this.syncSamples.push({
          t: row.t,
          stick: stick,
          t0,
          t1Ms,
          rttMs: row.t - t0,
          offsetObsMs: this.normalized(stick, (t0 + row.t) / 2 - t1Ms),
        });
        if (this.syncSamples.length > SYNC_KEEP) this.syncSamples.shift();
        break;
      }
      case 'log': {
        const p = row.log;
        if (!p) break;
        if (p.kind === 'drop') {
          this.dropTotals[p.reason] = (this.dropTotals[p.reason] ?? 0) + 1;
          this.dropEvents.push({ t: row.t, reason: p.reason });
        } else if (p.kind === 'i2cRec') {
          this.i2c = p.count;
        } else if (p.kind === 'boot') {
          this.build = p.raw;
          // 재부팅이면 그 스틱의 센서 로그 상태를 비운다(stick 모르면 둘 다)
          for (const s of row.stick === null ? this.sticks : [this.sticks[row.stick]]) {
            s.bias = null;
            s.imuFail = false;
          }
        } else if (p.kind === 'bias') {
          if (st) st.bias = p.values === null ? 'default' : 'measured';
        } else if (p.kind === 'imuFail') {
          if (st) st.imuFail = true;
        }
        break;
      }
      default:
        break;
    }
  }

  /** 오래된 → 최신. POSE 링과 나머지 링을 id 순으로 합친다(둘 다 정렬돼 있어 선형 병합) */
  rows(): readonly LogRow[] {
    if (this.merged && this.merged.version === this.version) return this.merged.rows;
    const a = this.poseBuf;
    const b = this.eventBuf;
    const out: LogRow[] = new Array(a.length + b.length);
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < a.length && j < b.length) out[k++] = a[i].id < b[j].id ? a[i++] : b[j++];
    while (i < a.length) out[k++] = a[i++];
    while (j < b.length) out[k++] = b[j++];
    this.merged = { version: this.version, rows: out };
    return out;
  }

  /** 해당 종류(decoded.kind 또는 'out')의 최근 n건. 오래된 → 최신 순서 */
  recent(kind: string, n: number): LogRow[] {
    const out: LogRow[] = [];
    const buf = kind === 'pose' ? this.poseBuf : this.eventBuf;
    for (let i = buf.length - 1; i >= 0 && out.length < n; i--) {
      const r = buf[i];
      const k = r.dir === 'out' ? 'out' : r.decoded?.kind;
      if (k === kind) out.push(r);
    }
    return out.reverse();
  }

  /** 지금(now) 기준 1초 창 통계. 호출 시 창 밖 이벤트를 정리한다 */
  stats(now: number = this.now()): MonitorStats {
    const from = now - WINDOW_MS;
    const prune = <T extends { t: number }>(xs: T[]): T[] => {
      let i = 0;
      while (i < xs.length && xs[i].t < from) i++;
      if (i) xs.splice(0, i);
      return xs;
    };

    this.rateEvents = prune(this.rateEvents);
    const ratePerType: Record<string, number> = {};
    for (const e of this.rateEvents) ratePerType[e.key] = (ratePerType[e.key] ?? 0) + 1;

    const perStick = this.sticks.map((st) => {
      st.hitEvents = prune(st.hitEvents);
      st.poseEvents = prune(st.poseEvents);
      const lossFrom = now - LOSS_KEEP_MS;
      let li = 0;
      while (li < st.hitLossEvents.length && st.hitLossEvents[li].t < lossFrom) li++;
      if (li) st.hitLossEvents.splice(0, li);
      const hitWin = st.hitEvents.reduce((a, e) => a + e.lost, 0);
      const seqPose = st.poseEvents.filter((e) => e.hasSeq);
      const poseWin = seqPose.reduce((a, e) => a + e.lost, 0);
      const pct = seqPose.length === 0 ? null : (poseWin / (seqPose.length + poseWin)) * 100;
      return {
        hitSeqLoss: { window: hitWin, total: st.hitLossTotal },
        poseSeqLoss: { window: poseWin, total: st.poseLossTotal, pct },
        hitFuture: {
          median: median(st.future),
          max: st.future.length ? Math.max(...st.future) : null,
          min: st.future.length ? Math.min(...st.future) : null,
        },
        hitLoss1m: st.hitLossEvents.reduce((a, e) => a + e.lost, 0),
        statusAgeMs: st.lastStatus ? now - st.lastStatus.t : null,
        lastStatus: st.lastStatus ? st.lastStatus.pkt : null,
        hitCount: st.hitCount,
        lastHitT: st.lastHitT,
        bias: st.bias,
        imuFail: st.imuFail,
      } satisfies StickStats;
    }) as [StickStats, StickStats];

    // 브리지 델타: 창 시작 이전의 마지막 표본을 기준으로 삼는다(없으면 가장 오래된 표본)
    const delta = { okFrames: 0, crcErrors: 0, resyncCount: 0 };
    const samples = this.bridgeSamples;
    if (samples.length > 0) {
      let baseIdx = 0;
      for (let i = 0; i < samples.length; i++) if (samples[i].t <= from) baseIdx = i;
      if (baseIdx > 0) samples.splice(0, baseIdx);
      const base = samples[0];
      const last = samples[samples.length - 1];
      delta.okFrames = Math.max(0, last.okFrames - base.okFrames);
      delta.crcErrors = Math.max(0, last.crcErrors - base.crcErrors);
      delta.resyncCount = Math.max(0, last.resyncCount - base.resyncCount);
    }
    const bridgeAge = this.lastBridge ? now - this.lastBridge.t : null;

    this.dropEvents = prune(this.dropEvents);
    const drops: MonitorStats['drops'] = {};
    for (const [reason, total] of Object.entries(this.dropTotals)) drops[reason] = { total, window: 0 };
    for (const e of this.dropEvents) drops[e.reason].window++;

    return {
      ratePerType,
      perStick,
      bridge: {
        last: this.lastBridge ? this.lastBridge.pkt : null,
        delta1s: delta,
        ageMs: bridgeAge,
        stalled: bridgeAge !== null && bridgeAge > BRIDGE_STALL_MS,
      },
      drops,
      i2cRecoveries: this.i2c,
      build: this.build,
      sync: {
        samples: [...this.syncSamples],
        adopted: [...this.adopted],
        lastLagMs: this.syncSamples.length ? this.syncSamples[this.syncSamples.length - 1].rttMs : null,
        count: this.syncCount,
        unmatched: this.syncUnmatched,
      },
      pedal: {
        present: this.pedalPresent,
        lastStatus: [this.pedalStatus[0]?.pkt ?? null, this.pedalStatus[1]?.pkt ?? null],
        statusAgeMs: [
          this.pedalStatus[0] ? now - this.pedalStatus[0].t : null,
          this.pedalStatus[1] ? now - this.pedalStatus[1].t : null,
        ],
        sync: { ...this.pedalSync },
      },
      padTable: { entries: [...this.padTable.values()], t: this.padTableT },
      errorCount: this.errorCount,
      total: this.total,
    };
  }

  /** 오프셋을 그 칸의 기준값(처음 본 오프셋)과 반 바퀴 이내로 맞춘다 */
  private normalized(slot: 0 | 1 | 2, offsetMs: number): number {
    const ref = this.offsetRef[slot];
    if (ref === null) {
      this.offsetRef[slot] = offsetMs;
      return offsetMs;
    }
    return normalizeOffsetMs(offsetMs, ref);
  }

  /**
   * 소스가 지금 채택한 시계 오프셋을 기록한다. 페이지가 스냅샷마다 부른다.
   * 직전 기록값과 0.5ms 이상 다를 때만 변화점으로 추가한다(null은 무시). 한 바퀴 차이는 정규화해 없앤다.
   */
  noteAdoptedOffsets(now: number, offsets: readonly [number | null, number | null]): void {
    for (const stick of [0, 1] as const) {
      const raw = offsets[stick];
      if (raw === null) continue;
      const o = this.normalized(stick, raw);
      const last = this.lastAdopted[stick];
      if (last !== null && Math.abs(o - last) < ADOPTED_MIN_STEP_MS) continue;
      this.lastAdopted[stick] = o;
      this.adopted.push({ t: now, stick, offsetMs: o });
      if (this.adopted.length > ADOPTED_KEEP) this.adopted.shift();
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 버퍼와 통계를 모두 비운다(구독은 유지) */
  clear(): void {
    this.poseBuf = [];
    this.eventBuf = [];
    this.merged = null;
    this.offsetRef = [null, null, null];
    this.pedalStatus = [null, null];
    this.pedalPresent = false;
    this.pedalSync = freshPedalSync();
    this.sticks = [freshStick(), freshStick()];
    this.rateEvents = [];
    this.bridgeSamples = [];
    this.lastBridge = null;
    this.dropTotals = {};
    this.dropEvents = [];
    this.i2c = null;
    this.build = null;
    this.pairer.clear();
    this.syncSamples = [];
    this.adopted = [];
    this.lastAdopted = [null, null];
    this.syncCount = 0;
    this.syncUnmatched = 0;
    this.padTable.clear();
    this.padTableT = null;
    this.errorCount = 0;
    this.total = 0;
    this.version++;
    for (const l of this.listeners) l();
  }
}

export const packetLog = new PacketLog();
