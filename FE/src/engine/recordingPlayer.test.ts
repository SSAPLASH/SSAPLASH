// 녹음 재생기 검증. 가짜 시계·타이머·오디오만 쓰고 performance.now·실제 타이머는 쓰지 않는다.
import { describe, expect, it, vi } from 'vitest';
import type { RecordingHit } from '@/domain/recording';
import {
  PLAYER_LOOKAHEAD_MS,
  PLAYER_START_LEAD_MS,
  PLAYER_TICK_MS,
  RecordingPlayer,
  type RecordingPlayerEvent,
} from './recordingPlayer';

interface Call {
  pad: string;
  velocity: number;
  whenMs: number | undefined;
  /** 호출 시점의 가짜 시계 */
  at: number;
}

function setup(ensure: () => Promise<unknown> = () => Promise.resolve()) {
  let now = 1000;
  let tickFn: (() => void) | null = null;
  const calls: Call[] = [];
  const player = new RecordingPlayer({
    audio: {
      trigger: (pad, velocity, whenMs) => {
        calls.push({ pad, velocity, whenMs, at: now });
        return whenMs ?? null;
      },
      ensure,
    },
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
  });
  return {
    player,
    calls,
    now: () => now,
    hasTimer: () => tickFn !== null,
    /** 시각을 ms만큼 틱 간격 단위로 흘린다 */
    advance(ms: number) {
      for (let t = 0; t < ms; t += PLAYER_TICK_MS) {
        now += PLAYER_TICK_MS;
        tickFn?.();
      }
    },
  };
}

const hit = (tMs: number, pad = 'snare'): RecordingHit => ({ tMs, pad: pad as RecordingHit['pad'], velocity: 100 });

describe('RecordingPlayer', () => {
  it('시작 시각은 now + 선행이고 예약 시각은 시작 + tMs다', async () => {
    const s = setup();
    const t0 = s.now();
    await s.player.play([hit(0), hit(500)]);
    const start = t0 + PLAYER_START_LEAD_MS;
    s.advance(1000);
    expect(s.calls.map((c) => c.whenMs)).toEqual([start, start + 500]);
  });

  it('시작 때 첫 tick을 즉시 돌아 창 안 타격을 바로 예약한다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(60), hit(200)]);
    // 시작 + 0, +60은 now + 100 이내(시작은 now + 50 → 시작 + 60 = now + 110 은 밖)
    expect(s.calls.map((c) => c.whenMs! - (s.now() + PLAYER_START_LEAD_MS))).toEqual([0]);
  });

  it('각 tick은 now + 100ms 안의 타격만 예약한다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(120), hit(260), hit(900)]);
    s.advance(1500);
    for (const c of s.calls) expect(c.whenMs!).toBeLessThanOrEqual(c.at + PLAYER_LOOKAHEAD_MS);
  });

  it('전체 타격이 끝까지 정확히 한 번씩 예약된다(중복 없음)', async () => {
    const s = setup();
    const hits = Array.from({ length: 40 }, (_, i) => hit(i * 37 + (i % 3)));
    await s.player.play(hits);
    s.advance(3000);
    expect(s.calls).toHaveLength(hits.length);
    const start = s.calls[0].whenMs! - hits[0].tMs;
    expect(s.calls.map((c) => c.whenMs! - start)).toEqual(hits.map((h) => h.tMs));
  });

  it('같은 시각의 타격(동시 타격)도 모두 한 번씩 예약된다', async () => {
    const s = setup();
    await s.player.play([hit(100, 'kick'), hit(100, 'snare'), hit(100, 'hihat')]);
    s.advance(500);
    expect(s.calls.map((c) => c.pad)).toEqual(['kick', 'snare', 'hihat']);
  });

  it('stop 뒤에는 시간이 흘러도 추가 예약이 없다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(400), hit(800)]);
    s.advance(250);
    const before = s.calls.length;
    s.player.stop();
    expect(s.player.playing).toBe(false);
    expect(s.hasTimer()).toBe(false);
    s.advance(2000);
    expect(s.calls).toHaveLength(before);
  });

  it('끝까지 재생하면 자동 정지하고 onEnd·상태 알림이 한 번 온다', async () => {
    const s = setup();
    const onEnd = vi.fn();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    await s.player.play([hit(0), hit(300)], { onEnd });
    expect(s.player.playing).toBe(true);
    s.advance(300);
    expect(s.player.playing).toBe(true);
    s.advance(100);
    expect(s.player.playing).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { playing: true, reason: 'start' },
      { playing: false, reason: 'end' },
    ]);
    expect(s.hasTimer()).toBe(false);
  });

  it('durationMs가 마지막 타격보다 길면 그 시각에 종료한다', async () => {
    const s = setup();
    const onEnd = vi.fn();
    await s.player.play([hit(0)], { durationMs: 1000, onEnd });
    s.advance(900);
    expect(s.player.playing).toBe(true);
    s.advance(250);
    expect(s.player.playing).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop()은 onEnd를 부르지 않고 stop 알림만 보낸다', async () => {
    const s = setup();
    const onEnd = vi.fn();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    await s.player.play([hit(0), hit(1000)], { onEnd });
    s.player.stop();
    s.player.stop(); // 두 번째는 무시
    expect(onEnd).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ playing: false, reason: 'stop' });
    expect(events.filter((e) => e.reason === 'stop')).toHaveLength(1);
  });

  it('positionMs는 재생 중 0~길이로 고정되고 정지면 0이다', async () => {
    const s = setup();
    expect(s.player.positionMs()).toBe(0);
    await s.player.play([hit(0), hit(500)]);
    expect(s.player.positionMs()).toBe(0); // 선행 구간에는 음수가 아니라 0
    s.advance(300);
    expect(s.player.positionMs()).toBe(300 - PLAYER_START_LEAD_MS);
    s.advance(150);
    expect(s.player.positionMs()).toBeLessThanOrEqual(500);
    s.player.stop();
    expect(s.player.positionMs()).toBe(0);
  });

  it('재생 중 play를 다시 부르면 이전 재생이 정지되고 새 시퀀스만 재생된다', async () => {
    const s = setup();
    const events: RecordingPlayerEvent[] = [];
    await s.player.play([hit(0, 'kick'), hit(2000, 'kick')]);
    s.player.onState((e) => events.push(e));
    await s.player.play([hit(0, 'crash'), hit(200, 'crash')]);
    s.advance(3000);
    const pads = s.calls.map((c) => c.pad);
    expect(pads.filter((p) => p === 'kick')).toHaveLength(1); // 이전 재생의 두 번째 타격은 나오지 않는다
    expect(pads.filter((p) => p === 'crash')).toHaveLength(2);
    expect(events[0]).toEqual({ playing: true, reason: 'start' });
  });

  it('ensure 대기 중 play를 연속으로 부르면 마지막 호출만 재생된다', async () => {
    const resolvers: Array<() => void> = [];
    const s = setup(() => new Promise<void>((r) => resolvers.push(r)));
    const p1 = s.player.play([hit(0, 'kick')]);
    const p2 = s.player.play([hit(0, 'crash')]);
    resolvers.forEach((r) => r());
    await Promise.all([p1, p2]);
    s.advance(500);
    expect(s.calls.map((c) => c.pad)).toEqual(['crash']);
  });

  it('ensure 대기 중 stop을 부르면 재생이 시작되지 않는다', async () => {
    let release: () => void = () => {};
    const s = setup(() => new Promise<void>((r) => (release = r)));
    const p = s.player.play([hit(0)]);
    s.player.stop();
    release();
    await p;
    expect(s.player.playing).toBe(false);
    expect(s.hasTimer()).toBe(false);
    expect(s.calls).toHaveLength(0);
  });

  it('ensure가 실패하면 예외를 던지고 재생 상태가 아니다', async () => {
    const s = setup(() => Promise.reject(new Error('오디오 해제 실패')));
    await expect(s.player.play([hit(0)])).rejects.toThrow('오디오 해제 실패');
    expect(s.player.playing).toBe(false);
    expect(s.hasTimer()).toBe(false);
  });

  it('빈 배열은 바로 종료 처리한다', async () => {
    const s = setup();
    const onEnd = vi.fn();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    await s.player.play([], { onEnd });
    expect(s.player.playing).toBe(false);
    expect(s.hasTimer()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ playing: false, reason: 'end' }]);
    expect(s.calls).toHaveLength(0);
  });

  it('onState 구독 해제 뒤에는 알림이 오지 않는다', async () => {
    const s = setup();
    const cb = vi.fn();
    const off = s.player.onState(cb);
    off();
    await s.player.play([hit(0)]);
    expect(cb).not.toHaveBeenCalled();
  });
});
