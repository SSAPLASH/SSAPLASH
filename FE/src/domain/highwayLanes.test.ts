import { describe, expect, it } from 'vitest';
import { HIGHWAY_LANES } from './highwayLanes';
import { ALL_PADS } from './pads';

describe('HIGHWAY_LANES', () => {
  it('하이햇 페달이 맨 왼쪽인 Figma 레인 순서(D10)', () => {
    expect(HIGHWAY_LANES).toEqual([
      'HIHAT_PEDAL',
      'HIHAT',
      'SNARE',
      'SMALL_TOM',
      'MID_TOM',
      'FLOOR_TOM',
      'RIDE',
      'CRASH',
      'KICK',
    ]);
  });

  it('중복이 없다', () => {
    expect(new Set(HIGHWAY_LANES).size).toBe(HIGHWAY_LANES.length);
  });

  it('domain/pads의 패드 집합과 일치한다', () => {
    expect([...HIGHWAY_LANES].sort()).toEqual([...ALL_PADS].sort());
  });
});
