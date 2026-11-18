// 텔레메트리 수집기. 설계 3-2~3-4·4장.
// diagTap(resolved·judged·session)과 packetTap(HIT seq·STATUS)을 구독해 wire 이벤트를 만들어 큐에 넣는다.
// 구독은 start()~stop() 사이만. 판정·입력 코드는 이 모듈을 모른다.
import type { StickId } from '@/domain/events';
import type { Judgement } from '@/domain/play/judgement';
import type { ResolvedHit } from '@/domain/events';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import { decodePacket } from '@/input/stickProtocol';
import { hitToEvent, statusToEvent, type TelemetryEvent, type TelemetryMode } from './wire';
import { defaultTimers, type Timers } from './sender';

/** resolved 뒤 judged를 기다리는 최대 시간(설계 U3) */
export const JUDGE_WAIT_MS = 300;

/** collector가 큐에 요구하는 부분 */
export interface EventSink {
  push(sessionId: string, mode: TelemetryMode, event: TelemetryEvent): void;
}

export interface CollectorDeps {
  sink: EventSink;
  /** 기본 diagTap */
  diag?: { subscribe(fn: (ev: DiagEvent) => void): () => void };
  /** 기본 packetTap */
  packets?: { subscribe(fn: (rec: PacketRecord) => void): () => void };
  /** 기본 `crypto.randomUUID()` */
  randomUUID?: () => string;
  /** 기본 `performance.timeOrigin` */
  timeOrigin?: number;
  timers?: Timers;
  judgeWaitMs?: number;
}

interface Pending {
  hit: ResolvedHit;
  sessionId: string;
  mode: TelemetryMode;
  timer: unknown;
}

/** 스틱별 직전 STATUS 이후 HIT seq 집계 */
interface SeqTracker {
  /** 마지막으로 본 HIT seq. 연결이 바뀌면 null */
  lastSeq: number | null;
  received: number;
  skipped: number;
}

/** 패킷의 손을 정한다: 링크가 알려 준 stickId, 없으면 flags의 role(0·1만). 못 정하면 null */
function resolveStick(recStick: 0 | 1 | null, role: number): StickId | null {
  if (recStick !== null) return recStick;
  return role === 0 || role === 1 ? role : null;
}

export class TelemetryCollector {
  private readonly sink: EventSink;
  private readonly diag: NonNullable<CollectorDeps['diag']>;
  private readonly packets: NonNullable<CollectorDeps['packets']>;
  private readonly randomUUID: () => string;
  private readonly timeOrigin: number;
  private readonly timers: Timers;
  private readonly judgeWaitMs: number;

  private unsubs: (() => void)[] = [];
  /** 세션 밖 진단용. 인스턴스(페이지)당 하나, 처음 필요할 때 만든다 */
  private diagnosticId: string | null = null;
  private session: { id: string; mode: TelemetryMode } | null = null;
  private pending = new Map<number, Pending>();
  private seq: Record<StickId, SeqTracker> = {
    0: { lastSeq: null, received: 0, skipped: 0 },
    1: { lastSeq: null, received: 0, skipped: 0 },
  };
  private firmware: Record<StickId, string | null> = { 0: null, 1: null };
  private activeSource: string | null = null;

  constructor(deps: CollectorDeps) {
    this.sink = deps.sink;
    this.diag = deps.diag ?? diagTap;
    this.packets = deps.packets ?? packetTap;
    this.randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
    this.timeOrigin = deps.timeOrigin ?? performance.timeOrigin;
    this.timers = deps.timers ?? defaultTimers;
    this.judgeWaitMs = deps.judgeWaitMs ?? JUDGE_WAIT_MS;
  }

  get running(): boolean {
    return this.unsubs.length > 0;
  }

  /** 구독 시작. 이미 시작했으면 무시 */
  start(): void {
    if (this.running) return;
    this.unsubs = [this.diag.subscribe((ev) => this.onDiag(ev)), this.packets.subscribe((rec) => this.onPacket(rec))];
  }

  /** 구독 해제. 판정을 기다리던 타격은 판정 null로 큐에 넣는다 */
  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const id of [...this.pending.keys()]) this.finalize(id, null, null);
  }

  /** 지금 쓰는 sessionId. 세션 중이면 그 UUID(플레이 기록 업로드가 같은 값을 쓸 수 있다), 밖이면 진단 UUID */
  currentSessionId(): string {
    return this.session?.id ?? this.getDiagnosticId();
  }

  /** 세션 밖이면 null */
  currentMode(): TelemetryMode {
    return this.session?.mode ?? null;
  }

  /** STATUS 이벤트 tags.source에 쓸 센서 소스 id. 모르면 패킷 transport 이름을 쓴다 */
  setActiveSource(kind: string | null): void {
    this.activeSource = kind;
  }

  /** 소스 연결 상태가 바뀌었을 때(bootstrap의 inputManager.onStatus가 부른다) STATUS를 하나 만든다 */
  notifyConnection(stickId: StickId, connected: boolean, source: string, atMs: number = performance.now()): void {
    // 재연결·재부팅이면 seq가 새로 시작하므로 집계를 비운다
    this.seq[stickId] = { lastSeq: null, received: 0, skipped: 0 };
    const ev = statusToEvent({
      stickId,
      connected,
      source,
      batteryPct: null,
      packetLoss: null,
      firmware: this.firmware[stickId],
      atMs,
      timeOrigin: this.timeOrigin,
    });
    if (ev) this.sink.push(this.currentSessionId(), this.currentMode(), ev);
  }

  private getDiagnosticId(): string {
    this.diagnosticId ??= this.randomUUID();
    return this.diagnosticId;
  }

  private onDiag(ev: DiagEvent): void {
    switch (ev.type) {
      case 'session':
        if (ev.phase === 'start') this.session = { id: this.randomUUID(), mode: ev.mode };
        else if (ev.phase === 'end') this.session = null;
        // pause·resume은 같은 UUID 유지
        return;
      case 'resolved': {
        const id = ev.hit.id;
        const old = this.pending.get(id);
        if (old) this.finalize(id, null, null);
        const timer = this.timers.setTimeout(() => this.finalize(id, null, null), this.judgeWaitMs);
        this.pending.set(id, { hit: ev.hit, sessionId: this.currentSessionId(), mode: this.currentMode(), timer });
        return;
      }
      case 'judged':
        if (this.pending.has(ev.hitId)) this.finalize(ev.hitId, ev.judgement, ev.deltaMs);
        return;
      default:
        return;
    }
  }

  /** 보관 중인 타격을 HIT 이벤트로 만들어 큐에 넣는다. tAudio 등은 이 시점의 hit 값을 읽는다 */
  private finalize(hitId: number, judgement: Judgement | null, deltaMs: number | null): void {
    const p = this.pending.get(hitId);
    if (!p) return;
    this.pending.delete(hitId);
    this.timers.clearTimeout(p.timer);
    const stick = p.hit.stickId;
    const ev = hitToEvent({
      hit: p.hit,
      judgement,
      deltaMs,
      firmware: stick === null ? null : (this.firmware[stick] ?? null),
      atMs: p.hit.tRecv,
      timeOrigin: this.timeOrigin,
    });
    if (ev) this.sink.push(p.sessionId, p.mode, ev);
  }

  private onPacket(rec: PacketRecord): void {
    if (rec.dir !== 'in') return;
    const d = decodePacket(rec.bytes, rec.recvTime);
    if (d.kind === 'hit') {
      const stick = resolveStick(rec.stickId, d.role);
      if (stick === null) return;
      const t = this.seq[stick];
      if (t.lastSeq !== null) t.skipped += (d.seq - t.lastSeq - 1) & 0xff;
      t.lastSeq = d.seq;
      t.received++;
    } else if (d.kind === 'status') {
      const stick = resolveStick(rec.stickId, d.role);
      if (stick === null) return;
      const t = this.seq[stick];
      const total = t.received + t.skipped;
      const packetLoss = total > 0 ? t.skipped / total : null;
      t.received = 0;
      t.skipped = 0;
      const firmware = `${d.fwMajor}.${d.fwMinor}`;
      this.firmware[stick] = firmware;
      const ev = statusToEvent({
        stickId: stick,
        connected: true,
        source: this.activeSource ?? rec.transport,
        batteryPct: d.batteryPct,
        packetLoss,
        firmware,
        atMs: rec.recvTime,
        timeOrigin: this.timeOrigin,
      });
      if (ev) this.sink.push(this.currentSessionId(), this.currentMode(), ev);
    }
  }
}
