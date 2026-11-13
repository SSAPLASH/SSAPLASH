// 녹음 재생기 검증. 가짜 시계·타이머·오디오만 쓰고 performance.now·실제 타이머는 쓰지 않는다.
import { describe, expect, it, vi } from 'vitest';
import type { RecordingHit } from '@/domain/play/recording';
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

  // ---- 일시정지·이어 재생·위치 옮기기 (338 녹음 재생바) ----
  it('pause는 위치를 붙잡고 예약을 멈춘다. 이어 재생하면 그 위치부터 남은 타격만 예약한다', async () => {
    const s = setup();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    await s.player.play([hit(0), hit(400), hit(800)], { durationMs: 1000 });
    s.advance(250); // 위치 200
    s.player.pause();
    expect(s.player.playing).toBe(false);
    expect(s.player.paused).toBe(true);
    expect(s.player.active).toBe(true);
    expect(s.hasTimer()).toBe(false);
    expect(s.player.positionMs()).toBe(200);
    const before = s.calls.length;
    s.advance(5000);
    expect(s.calls).toHaveLength(before);
    expect(s.player.positionMs()).toBe(200);

    const t = s.now();
    await s.player.resume();
    expect(s.player.playing).toBe(true);
    expect(s.player.paused).toBe(false);
    s.advance(1000);
    // 이어 재생의 기준 시각 = now + 선행 − 붙잡은 위치
    const start = t + PLAYER_START_LEAD_MS - 200;
    expect(s.calls.slice(before).map((c) => c.whenMs)).toEqual([start + 400, start + 800]);
    expect(events.map((e) => e.reason)).toEqual(['start', 'pause', 'resume', 'end']);
    expect(events[1]).toEqual({ playing: false, reason: 'pause' });
    expect(events[2]).toEqual({ playing: true, reason: 'resume' });
  });

  it('pause·resume은 해당 상태가 아니면 아무 일도 하지 않는다', async () => {
    const s = setup();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    s.player.pause();
    await s.player.resume();
    expect(events).toEqual([]);
    await s.player.play([hit(0), hit(500)]);
    await s.player.resume(); // 재생 중 resume은 무시
    s.player.pause();
    s.player.pause(); // 두 번째는 무시
    expect(events.map((e) => e.reason)).toEqual(['start', 'pause']);
  });

  it('재생 중 seek은 그 위치부터 다시 예약하고 positionMs가 따라간다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(400), hit(800)], { durationMs: 1000 });
    s.advance(100);
    const before = s.calls.length; // hit(0)만 예약됨
    const t = s.now();
    s.player.seek(700);
    expect(s.player.positionMs()).toBe(700 - PLAYER_START_LEAD_MS); // 선행만큼 뒤에서 시작
    s.advance(100);
    expect(s.player.positionMs()).toBe(750);
    s.advance(400);
    const start = t + PLAYER_START_LEAD_MS - 700;
    // 지나친 400은 건너뛰고 800만 예약
    expect(s.calls.slice(before).map((c) => c.whenMs)).toEqual([start + 800]);
    expect(s.player.playing).toBe(false); // 길이 1000에서 종료
  });

  it('뒤로 seek하면 지나간 타격을 다시 예약한다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(400), hit(800)], { durationMs: 1000 });
    s.advance(600);
    const before = s.calls.length; // 0·400 예약됨
    s.player.seek(300);
    s.advance(300);
    expect(s.calls.slice(before).map((c) => c.pad)).toHaveLength(1); // 400을 다시
    expect(s.player.playing).toBe(true);
  });

  it('일시정지 중 seek은 위치만 옮기고, 이어 재생하면 그 위치부터다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(400), hit(800)], { durationMs: 1000 });
    s.advance(100);
    s.player.pause();
    const before = s.calls.length;
    s.player.seek(600);
    expect(s.player.positionMs()).toBe(600);
    expect(s.calls).toHaveLength(before);
    expect(s.hasTimer()).toBe(false);
    await s.player.resume();
    s.advance(1000);
    expect(s.calls.slice(before)).toHaveLength(1); // 800만
  });

  it('seek은 0~길이로 자르고, 재생 대상이 없으면 무시한다', async () => {
    const s = setup();
    s.player.seek(500);
    expect(s.player.positionMs()).toBe(0);
    await s.player.play([hit(0), hit(500)], { durationMs: 1000 });
    s.player.pause();
    s.player.seek(-50);
    expect(s.player.positionMs()).toBe(0);
    s.player.seek(99_999);
    expect(s.player.positionMs()).toBe(1000);
    s.player.seek(Number.NaN);
    expect(s.player.positionMs()).toBe(1000);
  });

  it('일시정지 중 stop은 stop 알림을 보내고 위치를 0으로 되돌린다', async () => {
    const s = setup();
    const onEnd = vi.fn();
    const events: RecordingPlayerEvent[] = [];
    s.player.onState((e) => events.push(e));
    await s.player.play([hit(0), hit(500)], { onEnd });
    s.advance(200);
    s.player.pause();
    s.player.stop();
    expect(s.player.active).toBe(false);
    expect(s.player.paused).toBe(false);
    expect(s.player.positionMs()).toBe(0);
    expect(events.at(-1)).toEqual({ playing: false, reason: 'stop' });
    expect(onEnd).not.toHaveBeenCalled();
    await s.player.resume(); // 정지 뒤 resume은 무시
    expect(s.player.playing).toBe(false);
  });

  it('일시정지 중 새 play는 일시정지를 풀고 처음부터 재생한다', async () => {
    const s = setup();
    await s.player.play([hit(0), hit(500)]);
    s.advance(200);
    s.player.pause();
    await s.player.play([hit(0, 'kick'), hit(100, 'kick')]);
    expect(s.player.paused).toBe(false);
    expect(s.player.playing).toBe(true);
    expect(s.player.positionMs()).toBe(0);
  });

  it('ensure 대기 중인 resume은 그 사이 stop이 오면 재생하지 않는다', async () => {
    let release: () => void = () => {};
    let gate = false;
    const s = setup(() => (gate ? new Promise<void>((r) => (release = r)) : Promise.resolve()));
    await s.player.play([hit(0), hit(500)]);
    s.player.pause();
    gate = true;
    const p = s.player.resume();
    s.player.stop();
    release();
    await p;
    expect(s.player.playing).toBe(false);
    expect(s.hasTimer()).toBe(false);
  });
});
