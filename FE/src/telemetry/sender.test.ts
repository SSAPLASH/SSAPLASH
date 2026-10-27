import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { TelemetryQueue } from './queue';
import { TelemetrySender, postBatch, type PostBatch } from './sender';
import { statusToEvent } from './wire';

const S1 = '11111111-1111-4111-8111-111111111111';

function fill(q: TelemetryQueue, n: number, sessionId = S1): void {
  for (let i = 0; i < n; i++) {
    q.push(sessionId, null, statusToEvent({ stickId: 0, connected: true, source: 'ble', batteryPct: null, packetLoss: null, atMs: i, timeOrigin: 0 })!);
  }
}

function setup(post: PostBatch, onForbidden?: () => void) {
  const queue = new TelemetryQueue({ now: () => Date.now() });
  const sender = new TelemetrySender({ queue, now: () => Date.now(), post, onForbidden });
  return { queue, sender };
}

const ok = (n?: number) => async (b: { events: unknown[] }) => ({ acceptedCount: n ?? b.events.length });
const fail = (status: number, code = 'X', retryAfterMs: number | null = null) => async () => {
  throw new ApiError(status, code, `HTTP ${status}`, { retryAfterMs });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TelemetrySender 시작 조건', () => {
  it('1초 타이머마다 배치 하나를 보내고 acceptedCount를 누적한다', async () => {
    const post = vi.fn(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 3);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].events).toHaveLength(3);
    expect(sender.getState()).toMatchObject({ sent: 3, inflight: false, queueSize: 0 });
  });

  it('빈 큐면 보내지 않는다', async () => {
    const post = vi.fn(ok());
    const { sender } = setup(post);
    sender.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(post).not.toHaveBeenCalled();
  });

  it('큐가 100건에 도달하면 타이머를 기다리지 않고(한 틱 뒤) 보낸다', async () => {
    const post = vi.fn(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 99);
    await vi.advanceTimersByTimeAsync(10);
    expect(post).not.toHaveBeenCalled();
    fill(queue, 1);
    // push 호출 스택 안에서는 전송하지 않는다
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].events).toHaveLength(100);
  });

  it('stop() 뒤에는 타이머가 돌지 않는다', async () => {
    const post = vi.fn(ok());
    const { queue, sender } = setup(post);
    sender.start();
    sender.stop();
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(post).not.toHaveBeenCalled();
    expect(sender.getState().running).toBe(false);
  });
});

describe('TelemetrySender 동시 요청·타임아웃', () => {
  it('요청이 진행 중이면 다음 배치를 시작하지 않는다(동시 1개)', async () => {
    let resolve!: (v: unknown) => void;
    const post = vi.fn(() => new Promise((r) => (resolve = r)));
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(1000);
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(sender.getState().inflight).toBe(true);
    resolve({ acceptedCount: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('5초 안에 응답이 없으면 abort하고 결과 불명으로 집계, 같은 배치는 다시 보내지 않는다', async () => {
    const signals: AbortSignal[] = [];
    const post = vi.fn(
      (_b: unknown, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new ApiError(0, 'NETWORK', '서버에 연결할 수 없습니다.')));
        }),
    );
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(4999);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    expect(sender.getState()).toMatchObject({ unknown: 4, inflight: false, queueSize: 0 });
    expect(sender.getState().lastError).toMatchObject({ code: 'TIMEOUT', status: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('TelemetrySender 응답 처리', () => {
  it('400·413: 그 배치를 폐기·집계하고 대기 없이 다음 배치를 보낸다', async () => {
    const post = vi.fn().mockImplementationOnce(fail(400, 'BAD')).mockImplementationOnce(fail(413)).mockImplementation(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000);
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(1000);
    fill(queue, 3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sender.getState()).toMatchObject({ rejected: 3, sent: 3 });
    expect(sender.getState().lastError).toMatchObject({ status: 413 });
  });

  it('401: 그 배치는 재전송하지 않고 폐기, 다음 배치는 정상 전송', async () => {
    const post = vi.fn().mockImplementationOnce(fail(401, 'UNAUTHORIZED')).mockImplementation(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sender.getState()).toMatchObject({ unauthorized: 2, queueSize: 0 });
    fill(queue, 5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].events).toHaveLength(5);
    expect(sender.getState().sent).toBe(5);
  });

  it('403: 전송을 멈추고 forbidden 콜백을 부른다', async () => {
    const onForbidden = vi.fn();
    const post = vi.fn(fail(403, 'FORBIDDEN'));
    const { queue, sender } = setup(post, onForbidden);
    sender.start();
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(sender.getState()).toMatchObject({ running: false, forbidden: true, rejected: 2 });
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(post).toHaveBeenCalledTimes(1);
    // 다시 켜면 풀린다
    sender.start();
    expect(sender.getState().forbidden).toBe(false);
  });

  it('5xx·네트워크 오류: 결과 불명, 같은 배치 재전송 없음, 대기 1·2·4·8·10·10초, 성공하면 초기화', async () => {
    const times: number[] = [];
    let queueRef!: TelemetryQueue;
    const post = vi.fn<PostBatch>(async () => {
      times.push(Date.now());
      fill(queueRef, 1); // 매 요청 직후 새 이벤트가 있다고 가정
      throw new ApiError(503, 'X', 'HTTP 503');
    });
    const { queue, sender } = setup(post);
    queueRef = queue;
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(40_000);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 10_000]);
    expect(sender.getState().unknown).toBe(times.length);
    // 같은 배치를 다시 보내지 않는다: 매번 1건짜리 새 배치
    expect(post.mock.calls.every(([b]) => b.events.length === 1)).toBe(true);

    // 성공하면 대기가 초기화된다
    post.mockImplementationOnce(async () => {
      times.push(Date.now());
      fill(queueRef, 1);
      return { acceptedCount: 1 };
    });
    const n = times.length;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(times.length).toBeGreaterThan(n);
    const okAt = times[n];
    expect(times[n + 1] - okAt).toBe(1000);
  });

  it('대기 중에는 새 배치를 보내지 않는다(2번째 실패 뒤 2초)', async () => {
    const post = vi.fn(fail(500));
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000); // 1차 실패, 1초 대기
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000); // 2차 실패, 2초 대기
    expect(post).toHaveBeenCalledTimes(2);
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('429 Retry-After: 그 시간만큼 기다리고, 배치는 결과 불명 처리', async () => {
    const post = vi.fn().mockImplementationOnce(fail(429, 'RATE', 3000)).mockImplementation(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sender.getState().unknown).toBe(2);
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('429 Retry-After 없음: 지수 대기와 같다', async () => {
    const post = vi.fn().mockImplementationOnce(fail(429)).mockImplementationOnce(fail(429)).mockImplementation(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000); // 1초 대기
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000); // 2초 대기
    expect(post).toHaveBeenCalledTimes(2);
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('대기 중에도 큐 TTL은 적용된다', async () => {
    const post = vi.fn(fail(429, 'RATE', 30_000));
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000); // 429 → 30초 대기
    fill(queue, 2);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(sender.getState().drops.ttl).toBe(2);
    expect(sender.getState().queueSize).toBe(0);
  });
});

describe('TelemetrySender 상태 구독·flushOnce', () => {
  it('상태가 바뀔 때마다 구독자에게 알린다', async () => {
    const { queue, sender } = setup(ok());
    const seen: boolean[] = [];
    sender.subscribe(() => seen.push(sender.getState().inflight));
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  it('flushOnce는 대기 중이어도 배치 하나를 보낸다', async () => {
    const post = vi.fn().mockImplementationOnce(fail(500)).mockImplementation(ok());
    const { queue, sender } = setup(post);
    sender.start();
    fill(queue, 1);
    await vi.advanceTimersByTimeAsync(1000);
    fill(queue, 2);
    await sender.flushOnce();
    expect(post).toHaveBeenCalledTimes(2);
    expect(sender.getState().sent).toBe(2);
  });
});

describe('postBatch 기본 전송', () => {
  it('POST /api/telemetry/batches, 401이면 refresh만 하고 재전송하지 않는다', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/auth/refresh') return new Response(JSON.stringify({ accessToken: 'n', tokenType: 'Bearer', expiresIn: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response('{}', { status: 401, headers: { 'Content-Type': 'application/problem+json' } });
      }),
    );
    await expect(postBatch({ schemaVersion: 1, sessionId: S1, mode: null, events: [] }, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(['/api/telemetry/batches', '/api/auth/refresh']);
  });
});
