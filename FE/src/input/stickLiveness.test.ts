import { describe, expect, it } from 'vitest';
import { isPacketStreamSource, silentSticks, StickLivenessTracker, STICK_SILENCE_MS } from './stickLiveness';

describe('silentSticks', () => {
  it('추적 중인 손만, 기준 시간 이상 조용하면 고른다', () => {
    expect(silentSticks([0, 2500], 3000)).toEqual([0]);
    expect(silentSticks([0, 0], 2999)).toEqual([]);
    expect(silentSticks([null, 0], 3000)).toEqual([1]);
  });
});

describe('StickLivenessTracker', () => {
  it('한 손만 3초 무수신이면 그 손만 끊김이고 한 번만 알린다', () => {
    const t = new StickLivenessTracker();
    t.touch(0, 0);
    t.touch(1, 0);
    t.touch(0, 2000);
    expect(t.expire(STICK_SILENCE_MS)).toEqual([1]);
    expect(t.expire(STICK_SILENCE_MS + 100)).toEqual([]);
    expect(t.expire(5000)).toEqual([0]);
  });
  it('다시 패킷이 오면 추적이 되살아난다', () => {
    const t = new StickLivenessTracker();
    t.touch(1, 0);
    expect(t.expire(3000)).toEqual([1]);
    t.touch(1, 4000);
    expect(t.expire(6999)).toEqual([]);
    expect(t.expire(7000)).toEqual([1]);
  });
  it('clear한 손은 판정하지 않는다', () => {
    const t = new StickLivenessTracker();
    t.touch(0, 0);
    t.clear(0);
    expect(t.expire(10000)).toEqual([]);
  });
});

describe('isPacketStreamSource', () => {
  it('패킷 스트림 소스만 참', () => {
    expect(isPacketStreamSource('webserial')).toBe(true);
    expect(isPacketStreamSource('websocket')).toBe(true);
    expect(isPacketStreamSource('ble')).toBe(true);
    expect(isPacketStreamSource('pointer')).toBe(false);
    expect(isPacketStreamSource('keyboard')).toBe(false);
  });
});
