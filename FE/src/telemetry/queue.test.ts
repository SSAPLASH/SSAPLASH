import { describe, expect, it } from 'vitest';
import { MAX_BATCH_BYTES, TelemetryQueue, jsonBytes } from './queue';
import { buildBatch, statusToEvent, type TelemetryEvent } from './wire';

function ev(source = 'ble'): TelemetryEvent {
  return statusToEvent({ stickId: 0, connected: true, source, batteryPct: null, packetLoss: null, atMs: 0, timeOrigin: 0 })!;
}

/** tags.firmware 길이로 이벤트 크기를 키운다 */
function big(len: number): TelemetryEvent {
  const e = ev();
  (e.tags as { firmware?: string }).firmware = 'f'.repeat(len);
  return e;
}

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

function make(opts: { maxSize?: number; ttlMs?: number } = {}) {
  const clock = { t: 0 };
  const q = new TelemetryQueue({ now: () => clock.t, ...opts });
  return { q, clock };
}

const realBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe('TelemetryQueue 건수', () => {
  it('배치는 최대 100건이고 나머지는 큐에 남는다', () => {
    const { q } = make();
    for (let i = 0; i < 250; i++) q.push(S1, null, ev());
    expect(q.takeBatch()!.events).toHaveLength(100);
    expect(q.size).toBe(150);
    expect(q.takeBatch()!.events).toHaveLength(100);
    expect(q.takeBatch()!.events).toHaveLength(50);
    expect(q.takeBatch()).toBeNull();
  });

  it('1건짜리 배치도 가능하고 빈 큐는 null', () => {
    const { q } = make();
    expect(q.takeBatch()).toBeNull();
    q.push(S1, null, ev());
    expect(q.takeBatch()!.events).toHaveLength(1);
  });

  it('한 배치는 같은 sessionId·mode만 담는다(앞에서부터 이어지는 만큼)', () => {
    const { q } = make();
    q.push(S1, 'RHYTHM', ev());
    q.push(S1, 'RHYTHM', ev());
    q.push(S1, null, ev());
    q.push(S2, null, ev());
    const b1 = q.takeBatch()!;
    expect([b1.sessionId, b1.mode, b1.events.length]).toEqual([S1, 'RHYTHM', 2]);
    const b2 = q.takeBatch()!;
    expect([b2.sessionId, b2.mode, b2.events.length]).toEqual([S1, null, 1]);
    const b3 = q.takeBatch()!;
    expect([b3.sessionId, b3.mode]).toEqual([S2, null]);
  });
});

describe('TelemetryQueue 상한·TTL', () => {
  it('1,000건 상한: 1,001번째를 넣으면 가장 오래된 것을 버리고 overflow를 센다', () => {
    const { q } = make();
    for (let i = 0; i < 1000; i++) q.push(S1, null, ev(`s${i}`));
    expect(q.size).toBe(1000);
    expect(q.drops.overflow).toBe(0);
    q.push(S1, null, ev('last'));
    expect(q.size).toBe(1000);
    expect(q.drops.overflow).toBe(1);
    expect(q.takeBatch()!.events[0].tags.source).toBe('s1');
  });

  it('TTL 10초: 정확히 10초는 유지, 초과는 폐기하고 ttl을 센다', () => {
    const { q, clock } = make();
    q.push(S1, null, ev());
    clock.t = 10_000;
    q.expire();
    expect(q.size).toBe(1);
    clock.t = 10_001;
    q.push(S1, null, ev());
    expect(q.size).toBe(1);
    expect(q.drops.ttl).toBe(1);
  });

  it('takeBatch도 만료 항목을 먼저 버린다', () => {
    const { q, clock } = make();
    q.push(S1, null, ev());
    clock.t = 5000;
    q.push(S1, null, ev());
    clock.t = 12_000;
    expect(q.takeBatch()!.events).toHaveLength(1);
    expect(q.drops.ttl).toBe(1);
  });

  it('변화 알림: push·drop·take', () => {
    const { q } = make({ maxSize: 1 });
    const seen: string[] = [];
    q.onChange((c) => seen.push(c));
    q.push(S1, null, ev());
    q.push(S1, null, ev());
    q.takeBatch();
    expect(seen).toEqual(['push', 'drop', 'take']);
  });
});

describe('TelemetryQueue 바이트', () => {
  it('배치 직렬화 바이트가 128 KiB 이하가 되게 나눈다(실제 JSON 길이로 검증)', () => {
    const { q } = make({ maxSize: 5000 });
    for (let i = 0; i < 300; i++) q.push(S1, null, big(900));
    let total = 0;
    let batches = 0;
    for (let b = q.takeBatch(); b; b = q.takeBatch()) {
      expect(realBytes(b)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      total += b.events.length;
      batches++;
    }
    expect(total).toBe(300);
    expect(batches).toBeGreaterThanOrEqual(3);
  });

  it('한도 경계: 128 KiB에 들어가는 최대 건수만 담고 하나 더 담으면 넘는다', () => {
    const { q } = make({ maxSize: 5000 });
    // 이벤트가 작으면 건수 상한(100)에 먼저 걸리므로 필드를 하나 얹어 키운다
    const one = big(500);
    (one as unknown as { extra: string }).extra = 'x'.repeat(1500);
    const per = jsonBytes(one);
    const head = jsonBytes(buildBatch(S1, null, []));
    const fit = Math.floor((MAX_BATCH_BYTES - head + 1) / (per + 1));
    expect(fit).toBeLessThan(100);
    for (let i = 0; i < fit + 5; i++) q.push(S1, null, one);
    const b = q.takeBatch()!;
    expect(b.events.length).toBe(fit);
    expect(realBytes(b)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(realBytes(b) + per + 1).toBeGreaterThan(MAX_BATCH_BYTES);
  });

  it('멀티바이트 문자는 UTF-8 바이트로 센다', () => {
    expect(jsonBytes({ a: '가' })).toBe(jsonBytes({ a: 'a' }) + 2);
  });

  it('단일 이벤트가 tags 1 KiB를 넘으면 폐기하고 oversize를 센다', () => {
    const { q } = make();
    q.push(S1, null, big(1100));
    expect(q.size).toBe(0);
    expect(q.drops.oversize).toBe(1);
  });

  it('이벤트 하나가 128 KiB를 넘으면 폐기한다', () => {
    const { q } = make();
    const e = ev();
    (e as unknown as { extra: string }).extra = 'x'.repeat(MAX_BATCH_BYTES);
    q.push(S1, null, e);
    expect(q.size).toBe(0);
    expect(q.drops.oversize).toBe(1);
  });
});
