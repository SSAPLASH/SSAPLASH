// 모니터의 단일 입력. 직접 연결(같은 창의 packetTap·diagTap)과 따라보기(BroadcastChannel로 연주 창이 중계)를
// 같은 구독 함수 뒤에 둔다. 소비자(packetLog·judgeLog·ParamStore·SwingAssembler)는 모드를 모른다.
// 따라보기 프로토콜은 설계 3-5-1. 채널 이름·메시지 모양은 app/monitorRelay와 같지만 import하지 않는다(의존 방향).
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import type { TransportStats } from '@/input/source/InputSource';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import { ReplayOffsets, ReplayPlayer, type ReplaySpeed, type Timeline } from './recording/replay';

export type FeedMode = 'direct' | 'follow' | 'replay';

/** BroadcastChannel에서 쓰는 부분만 */
export interface FeedChannel {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export interface FollowStatus {
  /** hello가 3초 안에 왔는지 */
  connected: boolean;
  /** 마지막 hello 후 경과 ms. 한 번도 못 받았으면 null */
  helloAgeMs: number | null;
  source: string | null;
  profileId: string | null;
  /** 따르는 연주 창 id */
  windowId: string | null;
  /** 이 창 시각 기준으로 옮긴 시계 오프셋 */
  offsets: [number | null, number | null];
  transport: TransportStats | null;
  /** 연주 창 오디오 지연(ms) */
  audio: { baseMs: number; outputMs: number } | null;
}

export interface FeedDeps {
  createChannel?: () => FeedChannel;
  now?: () => number;
  timeOrigin?: () => number;
}

/** 재생 틱 간격(ms) */
export const REPLAY_TICK_MS = 20;

type Subscribe<T> = (fn: (v: T) => void) => () => void;
export interface FeedTaps {
  packet: Subscribe<PacketRecord>;
  diag: Subscribe<DiagEvent>;
}

/** hello가 이 시간 넘게 없으면 연주 창 없음 */
export const HELLO_TIMEOUT_MS = 3000;
const WATCH_MS = 1000;
export const FEED_CHANNEL = 'ssaplash-monitor';
/** 따라보기에서 다시 매기는 hitId의 시작값 */
export const FOLLOW_HIT_ID_BASE = 1_000_000_000;
/** 재부여 표 상한. 넘으면 오래된 것부터 버린다(판정은 타격 직후에 오므로 충분) */
const HIT_ID_KEEP = 2000;

/** 화면용 hitId. 따라보기에서 다시 매긴 id는 시작값을 빼 짧게(1부터) 보인다 */
export function hitIdLabel(id: number): string {
  return id >= FOLLOW_HIT_ID_BASE ? String(id - FOLLOW_HIT_ID_BASE + 1) : String(id);
}

interface Hello {
  k: 'hello';
  id: string;
  source: string;
  profileId: string | null;
  origin: number;
  offsets: [number | null, number | null];
  transport: TransportStats | null;
  audio?: { baseMs: number; outputMs: number } | null;
  at: number;
}
type Item = { k: 'packet'; rec: PacketRecord } | { k: 'diag'; ev: DiagEvent };

const shift = (v: number | null, d: number): number | null => (v === null ? null : v + d);

export class MonitorFeed {
  private _mode: FeedMode = 'direct';
  private packetListeners = new Set<(rec: PacketRecord) => void>();
  private diagListeners = new Set<(ev: DiagEvent) => void>();
  private offTaps: { packet: (() => void) | null; diag: (() => void) | null } = { packet: null, diag: null };
  private channel: FeedChannel | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;

  private windowId: string | null = null;
  private lastHelloAt: number | null = null;
  private d = 0;
  /**
   * 따라보기 hitId 재부여. 연주 창은 새로고침할 때마다 hitId를 1부터 다시 매기므로, 그대로 쓰면 이전 판과 이번 판의
   * 타격·판정이 같은 id로 섞인다. (연주 창 id, 원래 hitId) → 모니터 안에서 겹치지 않는 id. 이 창의 직접 연결 id와도
   * 겹치지 않게 큰 수에서 시작한다
   */
  private hitIds = new Map<string, number>();
  private nextHitId = FOLLOW_HIT_ID_BASE;
  private hello: Hello | null = null;

  /** 재생 모드 상태. 재생 시각 = 녹화 t를 재생 시점으로 옮긴 값이고, 옮긴 차이(replayD)는 줄마다 다르다(배속 때문) */
  private player: ReplayPlayer | null = null;
  private replayOffsets = new ReplayOffsets();
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private replayD = 0;
  /** 화면 스냅샷용 오프셋. 배속에서 d가 계속 변해 채택 오프셋이 매 틱 바뀌어 보이지 않게, 값이 새로 구해졌거나 1배속일 때만 갱신 */
  private replaySnap: { src: [number | null, number | null]; out: [number | null, number | null] } = {
    src: [null, null],
    out: [null, null],
  };

  private deps: FeedDeps;
  private taps: FeedTaps;

  constructor(
    deps: FeedDeps = {},
    taps: FeedTaps = { packet: (fn) => packetTap.subscribe(fn), diag: (fn) => diagTap.subscribe(fn) },
  ) {
    this.deps = deps;
    this.taps = taps;
  }

  get mode(): FeedMode {
    return this._mode;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  subscribePacket(fn: (rec: PacketRecord) => void): () => void {
    this.packetListeners.add(fn);
    this.syncTaps();
    return () => {
      this.packetListeners.delete(fn);
      this.syncTaps();
    };
  }

  subscribeDiag(fn: (ev: DiagEvent) => void): () => void {
    this.diagListeners.add(fn);
    this.syncTaps();
    return () => {
      this.diagListeners.delete(fn);
      this.syncTaps();
    };
  }

  /** 직접 연결일 때만, 그리고 구독자가 있을 때만 로컬 탭을 구독한다 */
  private syncTaps(): void {
    const direct = this._mode === 'direct';
    // 재생·따라보기에서는 로컬 탭을 구독하지 않는다
    if (direct && this.packetListeners.size > 0) {
      this.offTaps.packet ??= this.taps.packet((rec) => {
        for (const l of this.packetListeners) l(rec);
      });
    } else {
      this.offTaps.packet?.();
      this.offTaps.packet = null;
    }
    if (direct && this.diagListeners.size > 0) {
      this.offTaps.diag ??= this.taps.diag((ev) => {
        for (const l of this.diagListeners) l(ev);
      });
    } else {
      this.offTaps.diag?.();
      this.offTaps.diag = null;
    }
  }

  setMode(mode: FeedMode): void {
    // 재생은 openReplay(시간표 필요)로만 들어간다
    if (mode === this._mode || mode === 'replay') return;
    this.closeReplay();
    this._mode = mode;
    if (mode === 'follow') this.openChannel();
    else this.closeChannel();
    this.syncTaps();
  }

  /** 녹화 재생 시작. 로컬 탭·채널은 끊고 시간표를 구독자에게 흘린다. 바로 재생을 시작한다 */
  openReplay(timeline: Timeline): void {
    this.closeReplay();
    this.closeChannel();
    this._mode = 'replay';
    this.syncTaps();
    this.player = new ReplayPlayer(timeline);
    this.resetReplayOffsets();
    this.player.play(this.now());
    this.replayTimer = setInterval(() => this.replayTick(), REPLAY_TICK_MS);
  }

  private closeReplay(): void {
    if (this.replayTimer !== null) clearInterval(this.replayTimer);
    this.replayTimer = null;
    this.player = null;
  }

  private resetReplayOffsets(): void {
    this.replayOffsets.reset();
    this.replayD = 0;
    this.replaySnap = { src: [null, null], out: [null, null] };
  }

  /** 재생 조작. 재생 모드가 아니면 무시 */
  replayPlay(): void {
    this.player?.play(this.now());
  }

  replayPause(): void {
    this.player?.pause(this.now());
  }

  /** 처음부터 다시 재생. 오프셋도 다시 구한다(화면 상태 비우기는 호출자) */
  replayRestart(): void {
    if (!this.player) return;
    this.player.restart(this.now());
    this.resetReplayOffsets();
  }

  replaySetSpeed(s: ReplaySpeed): void {
    this.player?.setSpeed(s, this.now());
  }

  /** 재생 상태(화면용). 재생 모드가 아니면 null */
  replayStatus(): { state: 'paused' | 'playing' | 'ended'; speed: ReplaySpeed; elapsedMs: number; totalMs: number } | null {
    const p = this.player;
    if (!p) return null;
    return { state: p.state, speed: p.speed, elapsedMs: p.positionMs(this.now()), totalMs: p.timeline.durationMs };
  }

  /** 재생 중 packetLog에 넘길 오프셋(재생 시각 기준). 줄 하나를 내보내는 동안의 값이라 그 줄의 시각 이동을 반영한다 */
  replayOffsetOf(stick: 0 | 1): number | null {
    const o = this.replayOffsets.offsetOf(stick);
    return o === null ? null : o + this.replayD;
  }

  /** 화면 스냅샷용 오프셋(채택 오프셋 표시) */
  replaySnapshotOffsets(): [number | null, number | null] {
    const speed1 = this.player?.speed === 1;
    for (const s of [0, 1] as const) {
      const src = this.replayOffsets.offsetOf(s);
      if (src !== this.replaySnap.src[s] || speed1) {
        this.replaySnap.src[s] = src;
        this.replaySnap.out[s] = src === null ? null : src + this.replayD;
      }
    }
    return [this.replaySnap.out[0], this.replaySnap.out[1]];
  }

  private replayTick(): void {
    const p = this.player;
    if (!p) return;
    for (const { item, wallT } of p.take(this.now())) {
      const d = wallT - item.t;
      this.replayD = d;
      if (item.k === 'packet') {
        const r = item.row;
        this.replayOffsets.observe(item.t, r.dir, r.stick, item.bytes);
        if (this.packetListeners.size === 0) continue;
        const rec: PacketRecord = {
          id: this.nextId++,
          dir: r.dir,
          transport: r.transport as PacketRecord['transport'],
          // 직렬(동글) 패킷은 원래 손을 모르고 role에서 유도한다. 이전 파일은 페달이 stick에 role & 1로 적혀 있어 다시 유도하게 비운다
          stickId: r.transport === 'serial' ? null : r.stick,
          bytes: item.bytes,
          recvTime: wallT,
        };
        for (const l of this.packetListeners) l(rec);
      } else {
        this.emitShifted(item.ev, d, false);
      }
    }
  }

  private openChannel(): void {
    const ch = this.deps.createChannel ? this.deps.createChannel() : (new BroadcastChannel(FEED_CHANNEL) as unknown as FeedChannel);
    this.channel = ch;
    this.windowId = null;
    this.lastHelloAt = null;
    this.hello = null;
    ch.onmessage = (e) => this.onMessage(e.data);
    const watch = () => ch.postMessage({ k: 'watch', at: this.now() });
    watch();
    this.watchTimer = setInterval(watch, WATCH_MS);
  }

  private closeChannel(): void {
    if (this.watchTimer !== null) clearInterval(this.watchTimer);
    this.watchTimer = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.channel = null;
  }

  private onMessage(data: unknown): void {
    const m = data as { k?: string } | null;
    if (!m) return;
    if (m.k === 'ready') {
      // 연주 창이 새로 떴다. 다음 watch 주기를 기다리지 않고 바로 알린다
      this.channel?.postMessage({ k: 'watch', at: this.now() });
    } else if (m.k === 'hello') {
      const h = m as Hello;
      // 가장 최근 hello를 보낸 창을 따른다
      this.windowId = h.id;
      this.hello = h;
      this.lastHelloAt = this.now();
      const origin = this.deps.timeOrigin ? this.deps.timeOrigin() : performance.timeOrigin;
      this.d = h.origin - origin;
    } else if (m.k === 'batch') {
      const b = m as { id?: string; items?: Item[] };
      // 첫 hello 전이거나 따르는 창이 아니면 버린다(시각 정렬 값을 모른다)
      if (this.windowId === null || b.id !== this.windowId || !b.items) return;
      for (const it of b.items) {
        if (it.k === 'packet') this.emitPacket(it.rec);
        else if (it.k === 'diag') this.emitDiag(it.ev);
      }
    }
  }

  private emitPacket(rec: PacketRecord): void {
    if (this.packetListeners.size === 0) return;
    const out: PacketRecord = { ...rec, id: this.nextId++, recvTime: rec.recvTime + this.d };
    for (const l of this.packetListeners) l(out);
  }

  private emitDiag(ev: DiagEvent): void {
    this.emitShifted(ev, this.d, true);
  }

  /** 진단 이벤트를 시각 차이 d만큼 옮겨 내보낸다. remap이면 hitId를 다시 매긴다(따라보기), 아니면 원래 id 그대로(재생) */
  private emitShifted(ev: DiagEvent, d: number, remap: boolean): void {
    if (this.diagListeners.size === 0) return;
    let out: DiagEvent;
    if (ev.type === 'resolved') {
      const hit: ResolvedHit = {
        ...ev.hit,
        id: remap ? this.mapHitId(ev.hit.id, true) : ev.hit.id,
        tHit: ev.hit.tHit + d,
        tRecv: ev.hit.tRecv + d,
        tResolved: ev.hit.tResolved + d,
      };
      if (ev.hit.tAudio !== undefined) hit.tAudio = ev.hit.tAudio + d;
      out = { ...ev, hit, t: ev.t + d };
    } else if (ev.type === 'judged') {
      out = { ...ev, hitId: remap ? this.mapHitId(ev.hitId, false) : ev.hitId, t: ev.t + d };
    } else {
      out = { ...ev, t: ev.t + d };
    }
    for (const l of this.diagListeners) l(out);
  }

  /** resolved는 새 id를 받고, judged는 같은 창·같은 원래 id의 resolved가 받은 id를 쓴다 */
  private mapHitId(id: number, fresh: boolean): number {
    const key = `${this.windowId}:${id}`;
    const known = this.hitIds.get(key);
    if (known !== undefined && !fresh) return known;
    const next = this.nextHitId++;
    this.hitIds.delete(key);
    this.hitIds.set(key, next);
    if (this.hitIds.size > HIT_ID_KEEP) this.hitIds.delete(this.hitIds.keys().next().value as string);
    return next;
  }

  /** 따라보기 상태. 직접 연결이면 connected=false·값 비움 */
  followStatus(): FollowStatus {
    const h = this.hello;
    const age = this.lastHelloAt === null ? null : this.now() - this.lastHelloAt;
    const d = this.d;
    return {
      connected: age !== null && age < HELLO_TIMEOUT_MS,
      helloAgeMs: age,
      source: h ? h.source : null,
      profileId: h ? h.profileId : null,
      windowId: this.windowId,
      offsets: h ? [shift(h.offsets[0], d), shift(h.offsets[1], d)] : [null, null],
      transport: h ? h.transport : null,
      audio: h ? (h.audio ?? null) : null,
    };
  }
}

export const feed = new MonitorFeed();
