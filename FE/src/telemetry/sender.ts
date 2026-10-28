// 텔레메트리 전송기. 설계 3-5·4장.
// 1초 타이머 또는 큐 100건이 되면 배치 하나를 보낸다. 동시 요청 1개, 타임아웃 5초.
// 응답은 HTTP 상태로만 가른다(오류 code 문자열은 152번 확정 전이라 쓰지 않는다 — 설계 U2).
// 큐 적재는 동기이고 전송은 타이머·마이크로태스크 뒤라 연주 경로를 막지 않는다.
import { apiFetch, ApiError } from '@/api/http';
import { MAX_BATCH_EVENTS, type QueueDrops, type TelemetryQueue } from './queue';
import type { TelemetryBatch } from './wire';

/** 실제 경로는 152번 병합 뒤 확인한다(설계 U2) */
export const TELEMETRY_PATH = '/api/telemetry/batches';

export const FLUSH_INTERVAL_MS = 1000;
export const REQUEST_TIMEOUT_MS = 5000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 10_000;
/** 서버가 준 Retry-After가 지나치게 길어도 이 값까지만 기다린다 */
const RETRY_AFTER_MAX_MS = 60_000;

/** 배치 하나를 보낸다. 성공 응답 본문은 `{ acceptedCount }`. 실패는 ApiError(네트워크는 status 0) */
export type PostBatch = (batch: TelemetryBatch, signal: AbortSignal) => Promise<unknown>;

/** 기본 전송: apiFetch, 401이어도 같은 배치를 재전송하지 않는다 */
export const postBatch: PostBatch = (batch, signal) =>
  apiFetch<{ acceptedCount?: number }>(TELEMETRY_PATH, { method: 'POST', body: batch, signal, noRetryOn401: true });

/** 테스트에서 가짜 시계로 바꿀 수 있게 타이머를 주입한다. 기본은 전역 타이머(호출 시점에 읽는다) */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as number),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as number),
};

export interface SenderError {
  /** deps.now() 기준 */
  at: number;
  /** HTTP 상태. 네트워크 실패·타임아웃은 0 */
  status: number;
  /** 'TIMEOUT'은 이 모듈이 붙이고, 나머지는 ApiError.code */
  code: string;
  message: string;
}

/** 화면이 구독하는 상태 */
export interface SenderState {
  running: boolean;
  inflight: boolean;
  /** 서버가 받았다고 응답한 이벤트 수 누적 */
  sent: number;
  /** 결과 불명 이벤트 수(타임아웃·네트워크·5xx·429). 재전송하지 않는다 */
  unknown: number;
  /** 서버가 거절해 폐기한 이벤트 수(400·413·그 밖의 4xx·403) */
  rejected: number;
  /** 401로 폐기한 이벤트 수 */
  unauthorized: number;
  /** 큐가 센 폐기(상한·TTL·단일 초과) */
  drops: QueueDrops;
  queueSize: number;
  lastError: SenderError | null;
  /** 403을 받아 멈췄다. start()하면 풀린다 */
  forbidden: boolean;
}

export interface SenderDeps {
  queue: TelemetryQueue;
  now: () => number;
  post?: PostBatch;
  timers?: Timers;
  /** 403을 받아 전송을 멈출 때 불린다 */
  onForbidden?: () => void;
}

export class TelemetrySender {
  private readonly queue: TelemetryQueue;
  private readonly now: () => number;
  private readonly post: PostBatch;
  private readonly timers: Timers;
  private readonly onForbidden?: () => void;

  private running = false;
  private inflight = false;
  private sent = 0;
  private unknown = 0;
  private rejected = 0;
  private unauthorized = 0;
  private lastError: SenderError | null = null;
  private forbidden = false;
  /** 연속 실패 횟수. 지수 대기 단계, 성공하면 0 */
  private failStreak = 0;
  /** 이 시각(now) 전에는 새 전송을 시작하지 않는다 */
  private nextSendAt = 0;
  private intervalHandle: unknown = null;
  private unsubQueue: (() => void) | null = null;
  private flushScheduled = false;
  private listeners = new Set<() => void>();
  private snapshot: SenderState;

  constructor(deps: SenderDeps) {
    this.queue = deps.queue;
    this.now = deps.now;
    this.post = deps.post ?? postBatch;
    this.timers = deps.timers ?? defaultTimers;
    this.onForbidden = deps.onForbidden;
    this.snapshot = this.build();
  }

  /** 타이머를 시작한다. 이미 켜져 있으면 무시. 403으로 멈춘 상태도 여기서 풀린다 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.forbidden = false;
    this.intervalHandle = this.timers.setInterval(() => this.tryFlush(), FLUSH_INTERVAL_MS);
    this.unsubQueue = this.queue.onChange((c) => {
      if (c === 'push' && this.queue.size >= MAX_BATCH_EVENTS) this.scheduleFlush();
      else if (c === 'drop') this.notify();
    });
    this.notify();
  }

  /** 타이머·큐 구독을 해제한다. 진행 중인 요청은 끝까지 기다려 결과만 집계한다. 큐는 비우지 않는다 */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle !== null) this.timers.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.unsubQueue?.();
    this.unsubQueue = null;
    this.notify();
  }

  /** 대기 시간·진행 중 여부와 무관하게 배치 하나를 보낸다(끌 때·페이지 종료 때 최선 노력). 진행 중이면 무시 */
  async flushOnce(): Promise<void> {
    if (this.inflight) return;
    await this.dispatch();
  }

  getState(): SenderState {
    return this.snapshot;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private build(): SenderState {
    return {
      running: this.running,
      inflight: this.inflight,
      sent: this.sent,
      unknown: this.unknown,
      rejected: this.rejected,
      unauthorized: this.unauthorized,
      drops: { ...this.queue.drops },
      queueSize: this.queue.size,
      lastError: this.lastError,
      forbidden: this.forbidden,
    };
  }

  private notify(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }

  /** 큐 100건 도달: 연주 경로(push 호출 스택)에서 직렬화·요청을 하지 않도록 한 틱 미룬다 */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.timers.setTimeout(() => {
      this.flushScheduled = false;
      this.tryFlush();
    }, 0);
  }

  private tryFlush(): void {
    // 대기·진행 중에도 TTL은 지킨다
    this.queue.expire();
    if (!this.running || this.inflight || this.now() < this.nextSendAt) return;
    void this.dispatch();
  }

  /** 지수 대기: 1·2·4·8초, 최대 10초 */
  private backoff(): number {
    this.failStreak++;
    return Math.min(BACKOFF_BASE_MS * 2 ** (this.failStreak - 1), BACKOFF_MAX_MS);
  }

  private async dispatch(): Promise<void> {
    const batch = this.queue.takeBatch();
    if (!batch) return;
    const count = batch.events.length;
    this.inflight = true;
    this.notify();

    const ac = new AbortController();
    let timedOut = false;
    const timer = this.timers.setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await this.post(batch, ac.signal);
      const accepted = (res as { acceptedCount?: unknown } | undefined)?.acceptedCount;
      this.sent += typeof accepted === 'number' && Number.isFinite(accepted) ? accepted : count;
      this.failStreak = 0;
      this.nextSendAt = 0;
    } catch (e) {
      this.onFailure(e, count, timedOut);
    } finally {
      this.timers.clearTimeout(timer);
      this.inflight = false;
      this.notify();
    }
    if (this.running && this.queue.size >= MAX_BATCH_EVENTS) this.scheduleFlush();
  }

  /** 응답 처리 표(설계 3-5) */
  private onFailure(e: unknown, count: number, timedOut: boolean): void {
    const status = e instanceof ApiError ? e.status : 0;
    this.lastError = {
      at: this.now(),
      status: timedOut ? 0 : status,
      code: timedOut ? 'TIMEOUT' : e instanceof ApiError ? e.code : 'UNKNOWN',
      message: timedOut ? '응답 시간 초과' : e instanceof Error ? e.message : String(e),
    };
    const wait = (ms: number) => {
      this.nextSendAt = this.now() + ms;
    };

    if (timedOut) {
      this.unknown += count;
      wait(this.backoff());
    } else if (status === 401) {
      // refresh는 apiFetch가 이미 했다. 이 배치는 재생하지 않고 다음 배치부터 새 토큰으로
      this.unauthorized += count;
    } else if (status === 403) {
      this.rejected += count;
      this.forbidden = true;
      this.stop();
      this.onForbidden?.();
    } else if (status === 400 || status === 413) {
      this.rejected += count;
    } else if (status === 429) {
      this.unknown += count;
      const ra = e instanceof ApiError ? e.retryAfterMs : null;
      wait(ra !== null ? Math.min(ra, RETRY_AFTER_MAX_MS) : this.backoff());
    } else if (status >= 400 && status < 500 && status !== 408) {
      // 계약에 없는 4xx(경로·메서드 오류 등): 같은 오류를 1초마다 되풀이하지 않도록 대기
      this.rejected += count;
      wait(this.backoff());
    } else {
      // 네트워크(0)·408·5xx·그 밖: 결과 불명
      this.unknown += count;
      wait(this.backoff());
    }
  }
}
