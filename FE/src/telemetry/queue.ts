// 전송 대기 큐(순수, 시계 주입). 설계 2-3·3-1.
// 상한 1,000건·TTL 10초·오래된 것부터 폐기, 배치는 실제 JSON 직렬화 UTF-8 바이트와 건수로 나눈다.
import { buildBatch, type TelemetryBatch, type TelemetryEvent, type TelemetryMode } from './wire';

export const MAX_QUEUE_SIZE = 1000;
export const TTL_MS = 10_000;
export const MAX_BATCH_EVENTS = 100;
/** 요청 본문 상한(BE) */
export const MAX_BATCH_BYTES = 128 * 1024;
/** 이벤트당 직렬화된 tags 상한(BE) */
export const MAX_TAGS_BYTES = 1024;

/** 큐가 센 폐기 건수 */
export interface QueueDrops {
  /** 큐 상한 초과로 가장 오래된 것을 버림 */
  overflow: number;
  /** 대기 TTL 초과 */
  ttl: number;
  /** 단일 이벤트가 크기 상한 초과 */
  oversize: number;
}

export type QueueChange = 'push' | 'drop' | 'take';

interface Item {
  sessionId: string;
  mode: TelemetryMode;
  event: TelemetryEvent;
  /** 직렬화 UTF-8 바이트 */
  bytes: number;
  enqueuedAt: number;
}

export interface QueueOptions {
  now: () => number;
  maxSize?: number;
  ttlMs?: number;
}

const encoder = new TextEncoder();

/** JSON 직렬화한 UTF-8 바이트 수 */
export function jsonBytes(v: unknown): number {
  return encoder.encode(JSON.stringify(v)).length;
}

/** 이벤트 0건 외피의 바이트(`"events":[]` 포함). 배치 크기 = 이 값 + 이벤트 바이트 합 + (건수 - 1)개의 쉼표 */
function envelopeBytes(sessionId: string, mode: TelemetryMode): number {
  return jsonBytes(buildBatch(sessionId, mode, []));
}

export class TelemetryQueue {
  private items: Item[] = [];
  private readonly now: () => number;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly _drops: QueueDrops = { overflow: 0, ttl: 0, oversize: 0 };
  private listeners = new Set<(c: QueueChange) => void>();

  constructor(opts: QueueOptions) {
    this.now = opts.now;
    this.maxSize = opts.maxSize ?? MAX_QUEUE_SIZE;
    this.ttlMs = opts.ttlMs ?? TTL_MS;
  }

  get size(): number {
    return this.items.length;
  }

  get drops(): Readonly<QueueDrops> {
    return this._drops;
  }

  /** 큐 변화 알림(push·drop·take). 반환값은 해제 */
  onChange(l: (c: QueueChange) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(c: QueueChange): void {
    for (const l of this.listeners) l(c);
  }

  /** 적재. 동기 처리이며 네트워크를 기다리지 않는다 */
  push(sessionId: string, mode: TelemetryMode, event: TelemetryEvent): void {
    const bytes = jsonBytes(event);
    if (envelopeBytes(sessionId, mode) + bytes > MAX_BATCH_BYTES || jsonBytes(event.tags) > MAX_TAGS_BYTES) {
      this._drops.oversize++;
      this.emit('drop');
      return;
    }
    this.expire();
    this.items.push({ sessionId, mode, event, bytes, enqueuedAt: this.now() });
    let dropped = false;
    while (this.items.length > this.maxSize) {
      this.items.shift();
      this._drops.overflow++;
      dropped = true;
    }
    this.emit(dropped ? 'drop' : 'push');
  }

  /** 대기 시간이 TTL을 넘은 항목을 버린다(정확히 TTL이면 유지). 큐는 적재 순이라 앞에서부터 본다 */
  expire(): void {
    const t = this.now();
    let n = 0;
    while (n < this.items.length && t - this.items[n].enqueuedAt > this.ttlMs) n++;
    if (n === 0) return;
    this.items.splice(0, n);
    this._drops.ttl += n;
    this.emit('drop');
  }

  /**
   * 배치 하나를 꺼낸다(큐에서 제거). 앞에서부터 같은 sessionId·mode가 이어지는 만큼, 100건·128 KiB 이하로.
   * 비었으면 null. 만료 항목은 먼저 버린다.
   */
  takeBatch(): TelemetryBatch | null {
    this.expire();
    const first = this.items[0];
    if (!first) return null;
    let total = envelopeBytes(first.sessionId, first.mode);
    let n = 0;
    while (n < this.items.length && n < MAX_BATCH_EVENTS) {
      const it = this.items[n];
      if (it.sessionId !== first.sessionId || it.mode !== first.mode) break;
      const add = it.bytes + (n > 0 ? 1 : 0);
      if (total + add > MAX_BATCH_BYTES) break;
      total += add;
      n++;
    }
    const taken = this.items.splice(0, n);
    this.emit('take');
    return buildBatch(
      first.sessionId,
      first.mode,
      taken.map((i) => i.event),
    );
  }

  /** 모두 비운다(폐기 집계는 올리지 않는다 — 끄기 용도) */
  clear(): void {
    this.items = [];
  }
}
