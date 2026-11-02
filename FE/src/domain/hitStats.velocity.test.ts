import { describe, expect, it } from 'vitest';
import { addHit, emptyHitStats, meanVelocity } from './hitStats';

describe('meanVelocity', () => {
  it('타격이 없으면 null', () => {
    expect(meanVelocity(emptyHitStats())).toBeNull();
  });

  it('세기 평균', () => {
    let s = emptyHitStats();
    s = addHit(s, { pad: 'SNARE', source: 'keyboard', distanceDeg: undefined, velocity: 100 });
    s = addHit(s, { pad: 'SNARE', source: 'keyboard', distanceDeg: undefined, velocity: 60 });
    expect(meanVelocity(s)).toBe(80);
  });

  it('velocity 없는 입력은 평균에서 제외하되 total에는 센다', () => {
    let s = emptyHitStats();
    s = addHit(s, { pad: 'SNARE', source: 'keyboard', distanceDeg: undefined, velocity: 90 });
    s = addHit(s, { pad: 'SNARE', source: 'keyboard', distanceDeg: undefined });
    expect(s.total).toBe(2);
    expect(s.velocityCount).toBe(1);
    expect(meanVelocity(s)).toBe(90);
  });

  it('velocity 추가가 기존 필드를 바꾸지 않는다', () => {
    const a = addHit(emptyHitStats(), { pad: 'SNARE', source: 'sensor', distanceDeg: 4 });
    const b = addHit(emptyHitStats(), { pad: 'SNARE', source: 'sensor', distanceDeg: 4, velocity: 70 });
    expect(b.total).toBe(a.total);
    expect(b.byPad).toEqual(a.byPad);
    expect(b.unresolved).toBe(a.unresolved);
    expect(b.sensorDistanceSum).toBe(a.sensorDistanceSum);
    expect(b.sensorDistanceCount).toBe(a.sensorDistanceCount);
  });

  it('원본 통계를 바꾸지 않는다', () => {
    const s = emptyHitStats();
    addHit(s, { pad: 'SNARE', source: 'keyboard', distanceDeg: undefined, velocity: 50 });
    expect(s.velocityCount).toBe(0);
    expect(s.velocitySum).toBe(0);
  });
});
