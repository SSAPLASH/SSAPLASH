// 자유 연주 타격 통계(설계 4-3) 집계 규칙 검증.
import { describe, expect, it } from 'vitest';
import { addHit, emptyHitStats, meanSensorDistance } from './hitStats';

describe('emptyHitStats', () => {
  it('패드 9개가 모두 0이고 합계·판정 없음·거리도 0이다', () => {
    const s = emptyHitStats();
    expect(Object.keys(s.byPad)).toHaveLength(9);
    expect(Object.values(s.byPad).every((v) => v === 0)).toBe(true);
    expect(s.total).toBe(0);
    expect(s.unresolved).toBe(0);
    expect(meanSensorDistance(s)).toBeNull();
  });
});

describe('addHit', () => {
  it('패드별 횟수와 합계를 누적하고 원본은 바꾸지 않는다', () => {
    const s0 = emptyHitStats();
    const s1 = addHit(s0, { pad: 'SNARE', source: 'keyboard' });
    const s2 = addHit(s1, { pad: 'SNARE', source: 'keyboard' });
    const s3 = addHit(s2, { pad: 'KICK', source: 'keyboard' });
    expect(s3.byPad.SNARE).toBe(2);
    expect(s3.byPad.KICK).toBe(1);
    expect(s3.total).toBe(3);
    expect(s0.total).toBe(0);
    expect(s0.byPad.SNARE).toBe(0);
  });

  it('패드가 없는 타격은 판정 없음으로 센다', () => {
    const s = addHit(emptyHitStats(), { pad: null, source: 'pointer', distanceDeg: 30 });
    expect(s.unresolved).toBe(1);
    expect(s.total).toBe(1);
    expect(Object.values(s.byPad).every((v) => v === 0)).toBe(true);
  });

  it('키보드 타격은 거리 평균에 들어가지 않는다', () => {
    const s = addHit(emptyHitStats(), { pad: 'HIHAT', source: 'keyboard', distanceDeg: 5 });
    expect(meanSensorDistance(s)).toBeNull();
  });

  it('센서 타격은 앵커 안·밖 모두 거리 평균에 들어간다', () => {
    let s = emptyHitStats();
    s = addHit(s, { pad: 'SNARE', source: 'pointer', distanceDeg: 4 });
    s = addHit(s, { pad: null, source: 'pointer', distanceDeg: 20 });
    s = addHit(s, { pad: 'RIDE', source: 'ble' });
    expect(s.sensorDistanceCount).toBe(2);
    expect(meanSensorDistance(s)).toBe(12);
  });

  it('초기화는 emptyHitStats로 돌아간다', () => {
    const s = addHit(emptyHitStats(), { pad: 'CRASH', source: 'keyboard' });
    expect(emptyHitStats()).toEqual(emptyHitStats());
    expect(s).not.toEqual(emptyHitStats());
  });
});
