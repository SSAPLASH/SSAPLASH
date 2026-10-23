// 패킷 로그. packetTap 레코드를 디코드해 링버퍼에 쌓고, 1초 창 통계(MonitorStats)를 계산한다.
// 시각 펼치기(TsUnwrap)로 tBrowser·futureMs를 채운다. 타이머는 만들지 않는다 — stats() 호출 주기는 화면이 정한다.
import type { PacketRecord } from '@/input/packetTap';
import { packetTap } from '@/input/packetTap';
import {
  decodePacket,
  type DecodedBridgeStats,
  type DecodedPacket,
  type DecodedStatus,
  CommandType,
} from '@/input/stickProtocol';
import { parseLogText, type ParsedLog } from './logParse';
import { futureMs, toBrowserMs, TsUnwrap } from './tsUnwrap';

export interface LogRow {
  id: number;
  /** 수신(송신) 시각 performance.now() */
  t: number;
  dir: 'in' | 'out';
  transport: PacketRecord['transport'];
  stick: 0 | 1 | null;
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
  hitFuture: { median: number | null; max: number | null };
  statusAgeMs: number | null;
  lastStatus: DecodedStatus | null;
  hitCount: number;
  lastHitT: number | null;
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
  syncAck: { lastLagMs: number | null; lags: number[]; count: number };
  errorCount: number;
  total: number;
}

export interface PacketLogDeps {
  now?: () => number;
  clockOffsetOf?: (stick: 0 | 1) => number | null;
}

const WINDOW_MS = 1000;
const FUTURE_KEEP = 50;
const LAG_KEEP = 20;
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
  poseEvents: SeqEvent[];
  future: number[];
  lastStatus: { pkt: DecodedStatus; t: number } | null;
  hitCount: number;
  lastHitT: number | null;
}

const freshStick = (): StickState => ({
  lastHitSeq: null,
  lastPoseSeq: null,
  hitLossTotal: 0,
  poseLossTotal: 0,
  hitEvents: [],
  poseEvents: [],
  future: [],
  lastStatus: null,
  hitCount: 0,
  lastHitT: null,
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

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

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
  private unwrap = new TsUnwrap();

  private sticks: [StickState, StickState] = [freshStick(), freshStick()];
  private rateEvents: { t: number; key: string }[] = [];
  private bridgeSamples: BridgeSample[] = [];
  private lastBridge: { pkt: DecodedBridgeStats; t: number } | null = null;
  private dropTotals: Record<string, number> = {};
  private dropEvents: { t: number; reason: string }[] = [];
  private i2c: number | null = null;
  private build: string | null = null;
  private pendingSync: number[] = [];
  private lags: number[] = [];
  private lastLag: number | null = null;
  private syncCount = 0;
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

  /** tap 구독 시작. 중복 호출은 무해하다 */
  start(): void {
    if (this.offTap) return;
    this.offTap = packetTap.subscribe((rec) => this.ingest(rec));
  }

  stop(): void {
    this.offTap?.();
    this.offTap = null;
  }

  /** 레코드 한 건 처리. 테스트·모의에서 직접 불러도 된다 */
  ingest(rec: PacketRecord): void {
    const decoded = rec.dir === 'in' ? decodePacket(rec.bytes, rec.recvTime) : null;
    const role = decoded && 'role' in decoded ? decoded.role : null;
    const stick: 0 | 1 | null = rec.stickId ?? (role !== null ? ((role & 1) as 0 | 1) : null);

    let tBrowser: number | null = null;
    let future: number | null = null;
    if (decoded && stick !== null && (decoded.kind === 'hit' || decoded.kind === 'pose' || decoded.kind === 'syncAck')) {
      const us = decoded.kind === 'syncAck' ? decoded.t1Us : decoded.timestampUs;
      const unwrapped = this.unwrap.feed(stick, us);
      tBrowser = toBrowserMs(unwrapped, this.deps.clockOffsetOf ? this.deps.clockOffsetOf(stick) : null);
      if (decoded.kind !== 'syncAck') future = futureMs(tBrowser, rec.recvTime);
    }

    const row: LogRow = {
      id: rec.id,
      t: rec.recvTime,
      dir: rec.dir,
      transport: rec.transport,
      stick,
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
    this.updateStats(row);

    this.version++;
    for (const l of this.listeners) l();
  }

  private updateStats(row: LogRow): void {
    if (row.dir === 'out') {
      if (row.outType === CommandType.SYNC) this.pendingSync.push(row.t);
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
        break;
      case 'bridgeStats':
        this.lastBridge = { pkt: d, t: row.t };
        this.bridgeSamples.push({ t: row.t, okFrames: d.okFrames, crcErrors: d.crcErrors, resyncCount: d.resyncCount });
        break;
      case 'syncAck': {
        this.syncCount++;
        const t0 = this.pendingSync.shift();
        if (t0 !== undefined) {
          const lag = row.t - t0;
          this.lastLag = lag;
          this.lags.push(lag);
          if (this.lags.length > LAG_KEEP) this.lags.shift();
        }
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
      const hitWin = st.hitEvents.reduce((a, e) => a + e.lost, 0);
      const seqPose = st.poseEvents.filter((e) => e.hasSeq);
      const poseWin = seqPose.reduce((a, e) => a + e.lost, 0);
      const pct = seqPose.length === 0 ? null : (poseWin / (seqPose.length + poseWin)) * 100;
      return {
        hitSeqLoss: { window: hitWin, total: st.hitLossTotal },
        poseSeqLoss: { window: poseWin, total: st.poseLossTotal, pct },
        hitFuture: { median: median(st.future), max: st.future.length ? Math.max(...st.future) : null },
        statusAgeMs: st.lastStatus ? now - st.lastStatus.t : null,
        lastStatus: st.lastStatus ? st.lastStatus.pkt : null,
        hitCount: st.hitCount,
        lastHitT: st.lastHitT,
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
      syncAck: { lastLagMs: this.lastLag, lags: [...this.lags], count: this.syncCount },
      errorCount: this.errorCount,
      total: this.total,
    };
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
    this.unwrap.reset();
    this.sticks = [freshStick(), freshStick()];
    this.rateEvents = [];
    this.bridgeSamples = [];
    this.lastBridge = null;
    this.dropTotals = {};
    this.dropEvents = [];
    this.i2c = null;
    this.build = null;
    this.pendingSync = [];
    this.lags = [];
    this.lastLag = null;
    this.syncCount = 0;
    this.errorCount = 0;
    this.total = 0;
    this.version++;
    for (const l of this.listeners) l();
  }
}

export const packetLog = new PacketLog();
