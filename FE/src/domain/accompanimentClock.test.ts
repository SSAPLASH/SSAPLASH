// 반주 위치 계산 검증.
import { describe, expect, it } from 'vitest';
import { playbackPosition, zeroPerfMs } from './accompanimentClock';

describe('playbackPosition', () => {
  it('시작 시각 이전에는 fromMs, 이후에는 경과 시간을 더한다', () => {
    expect(playbackPosition(1000, 0, 500, 60000)).toBe(0);
    expect(playbackPosition(1000, 0, 3500, 60000)).toBe(2500);
    expect(playbackPosition(1000, 4000, 1500, 60000)).toBe(4500);
  });

  it('길이를 넘으면 durationMs로 자른다', () => {
    expect(playbackPosition(0, 0, 90000, 60000)).toBe(60000);
  });

  it('일시정지 위치를 보존해 재개하면 이어서 센다', () => {
    // 1000에 시작, 3000에 정지 → 2000. 3500에 재개 → 4000 시점 위치 2500
    const paused = playbackPosition(1000, 0, 3000, 60000);
    expect(paused).toBe(2000);
    expect(playbackPosition(3500, paused, 4000, 60000)).toBe(2500);
  });

  it('반주 0초 시각은 시작 시각에서 fromMs를 뺀 값이다', () => {
    expect(zeroPerfMs(1000, 0)).toBe(1000);
    expect(zeroPerfMs(3500, 2000)).toBe(1500);
  });
});
