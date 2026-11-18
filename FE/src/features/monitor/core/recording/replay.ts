// 녹화 재생(순수). 되읽은 녹화(패킷 줄·진단 줄)를 원래 t 순의 시간표로 합치고, 재생·일시정지·배속을 상태기로 다룬다.
// 시계는 밖에서 now를 넘긴다(타이머 없음). 시계 오프셋은 녹화의 SYNC 송신·SYNC_ACK 짝에서 소스(ClockSync)와 같은 식으로 다시 구한다.
import type { DiagEvent } from '@/engine/diagTap';
import { ClockSync } from '@/input/source/InputSource';
import { CommandType, decodePacket, handOf, PacketType } from '@/input/stickProtocol';
import { hexToBytes, type RecordedRow } from './recorder';
import { SyncPairer, syncKeyOf } from '@/features/monitor/core/syncPair';

export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export type TimelineItem =
  | { k: 'packet'; t: number; row: RecordedRow; bytes: Uint8Array }
  | { k: 'diag'; t: number; ev: DiagEvent };

export interface Timeline {
  /** 원래 t 순(같은 t면 패킷이 진단보다 앞) */
  items: TimelineItem[];
  /** 첫 줄의 원래 t */
  startT: number;
  /** 첫 줄~마지막 줄 ms */
  durationMs: number;
  packetCount: number;
  diagCount: number;
}

/** 되읽은 녹화 → 시간표. 줄이 없으면 빈 시간표(길이 0) */
export function buildTimeline(parsed: { rows: RecordedRow[]; diags: DiagEvent[] }): Timeline {
  const items: TimelineItem[] = [
    ...parsed.rows.map((row): TimelineItem => ({ k: 'packet', t: row.t, row, bytes: hexToBytes(row.hex) })),
    ...parsed.diags.map((ev): TimelineItem => ({ k: 'diag', t: ev.t, ev })),
  ];
  // Array.sort는 안정 정렬이라 같은 t에서는 위에서 먼저 넣은 패킷이 앞에 온다
  items.sort((a, b) => a.t - b.t);
  const startT = items.length ? items[0].t : 0;
  const endT = items.length ? items[items.length - 1].t : 0;
  return { items, startT, durationMs: endT - startT, packetCount: parsed.rows.length, diagCount: parsed.diags.length };
}

export type ReplayState = 'paused' | 'playing' | 'ended';

export interface DueItem {
  item: TimelineItem;
  /** 이 줄이 나왔어야 할 now 기준 시각. 틱이 늦어도 줄 사이 간격이 유지된다 */
  wallT: number;
}

/**
 * 재생 상태기. now(ms, 단조 시계)는 호출마다 넘긴다.
 * 위치(pos) = 시간표 시작 후 경과 ms(녹화 시간). 재생 중에는 (now − 기준 now) × 배속만큼 늘어난다.
 */
export class ReplayPlayer {
  private cursor = 0;
  private _state: ReplayState = 'paused';
  private _speed: ReplaySpeed = 1;
  private anchorWall = 0;
  private anchorPos = 0;
  private queue: DueItem[] = [];

  readonly timeline: Timeline;

  constructor(timeline: Timeline) {
    this.timeline = timeline;
  }

  get state(): ReplayState {
    return this._state;
  }

  get speed(): ReplaySpeed {
    return this._speed;
  }

  /** 지금까지의 녹화 시간 경과(ms). 전체 길이를 넘지 않는다 */
  positionMs(now: number): number {
    const pos = this._state === 'playing' ? this.anchorPos + (now - this.anchorWall) * this._speed : this.anchorPos;
    return Math.min(pos, this.timeline.durationMs);
  }

  private wallOf(itemPos: number): number {
    return this.anchorWall + (itemPos - this.anchorPos) / this._speed;
  }

  /** 지금 위치까지 도달한 줄을 대기열에 모은다(기준이 바뀌기 전에 불러야 시각이 정확하다) */
  private collect(now: number): void {
    if (this._state !== 'playing') return;
    const pos = this.positionMs(now);
    const { items, startT, durationMs } = this.timeline;
    while (this.cursor < items.length && items[this.cursor].t - startT <= pos) {
      const item = items[this.cursor++];
      this.queue.push({ item, wallT: this.wallOf(item.t - startT) });
    }
    if (pos >= durationMs && this.cursor >= items.length) {
      this._state = 'ended';
      this.anchorPos = durationMs;
    }
  }

  /** 내보낼 때가 된 줄을 시각 순으로 돌려준다 */
  take(now: number): DueItem[] {
    this.collect(now);
    const out = this.queue;
    this.queue = [];
    return out;
  }

  play(now: number): void {
    if (this._state === 'playing') return;
    if (this._state === 'ended') this.restart(now);
    this._state = 'playing';
    this.anchorWall = now;
  }

  pause(now: number): void {
    if (this._state !== 'playing') return;
    this.collect(now);
    if (this._state !== 'playing') return; // collect가 끝으로 판단함
    this.anchorPos = this.positionMs(now);
    this._state = 'paused';
  }

  /** 처음부터 다시 재생한다 */
  restart(now: number): void {
    this.cursor = 0;
    this.queue = [];
    this.anchorPos = 0;
    this.anchorWall = now;
    this._state = 'playing';
  }

  setSpeed(speed: ReplaySpeed, now: number): void {
    if (speed === this._speed) return;
    if (this._state === 'playing') {
      this.collect(now);
      if (this._state === 'playing') {
        this.anchorPos = this.positionMs(now);
        this.anchorWall = now;
      }
    }
    this._speed = speed;
  }
}

/** 오프셋 계산식(InputSource ClockSync와 같다): 브라우저 = 스틱 + offset, (t0 + t2) / 2 − t1 */
export function syncOffsetMs(t0: number, t1Ms: number, t2: number): number {
  return (t0 + t2) / 2 - t1Ms;
}

/**
 * 녹화의 SYNC 송신(out, t0 = 1바이트 뒤 u32 LE)과 SYNC_ACK(in)를 SyncPairer로 짝지어 스틱별 오프셋을 다시 구한다.
 * 연주 때 소스가 쓰는 ClockSync를 그대로 돌려, 그때 게임이 썼을 오프셋과 같은 규칙(최근 창의 최소 왕복 + 천천히 따라가기)으로 낸다.
 * 시각은 녹화 원래 시각 기준이다(재생 시각으로 옮기는 건 호출자).
 */
export class ReplayOffsets {
  private pairer = new SyncPairer();
  private clocks: [ClockSync, ClockSync] = [new ClockSync(), new ClockSync()];

  reset(): void {
    this.pairer.clear();
    for (const c of this.clocks) c.reset();
  }

  /** 패킷 한 줄을 보여준다. t = 녹화 원래 시각 */
  observe(t: number, dir: 'in' | 'out', stickId: 0 | 1 | null, bytes: Uint8Array): void {
    this.pairer.expire(t);
    if (dir === 'out') {
      if (bytes[0] === CommandType.SYNC) {
        const key = syncKeyOf(bytes);
        if (key !== null) this.pairer.addOut(t, key);
      }
      return;
    }
    if (bytes[0] !== PacketType.SYNC_ACK) return;
    const d = decodePacket(bytes, t);
    if (d.kind !== 'syncAck') return;
    // 페달(role 2·3)의 SYNC_ACK는 손 오프셋이 아니다. 이전 파일은 stick이 role & 1로 적혀 있어 role로 거른다
    const hand = handOf(d.role);
    if (hand === null) return;
    const stick: 0 | 1 = stickId ?? hand;
    const t0 = this.pairer.match(d.t0Ms, stick);
    if (t0 === null) return;
    this.clocks[stick].addSample(t0, d.t1Us / 1000, t);
  }

  /** 녹화 시각 기준 오프셋. 아직 없으면 null */
  offsetOf(stick: 0 | 1): number | null {
    return this.clocks[stick].offset;
  }
}
