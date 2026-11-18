import { describe, expect, it } from 'vitest';
import { HIGHWAY_LANES, LANE_COLOR, laneColorOf, laneGroupOf } from './highwayLanes';
import { ALL_PADS } from '@/domain/kit/pads';

describe('HIGHWAY_LANES', () => {
  it('드럼 배치 순이고 하이햇 페달만 맨 왼쪽(MODE 2차 U1)', () => {
    expect(HIGHWAY_LANES).toEqual([
      'HIHAT_PEDAL',
      'HIHAT',
      'CRASH',
      'SNARE',
      'SMALL_TOM',
      'KICK',
      'MID_TOM',
      'FLOOR_TOM',
      'RIDE',
    ]);
  });

  it('중복이 없다', () => {
    expect(new Set(HIGHWAY_LANES).size).toBe(HIGHWAY_LANES.length);
  });

  it('domain/kit/pads의 패드 집합과 일치한다', () => {
    expect([...HIGHWAY_LANES].sort()).toEqual([...ALL_PADS].sort());
  });
});

describe('레인 색 묶음', () => {
  it('심벌·북·킥으로 묶는다', () => {
    expect(['HIHAT_PEDAL', 'HIHAT', 'CRASH', 'RIDE'].map((p) => laneGroupOf(p as never))).toEqual(['cymbal', 'cymbal', 'cymbal', 'cymbal']);
    expect(['SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM'].map((p) => laneGroupOf(p as never))).toEqual(['drum', 'drum', 'drum', 'drum']);
    expect(laneGroupOf('KICK')).toBe('kick');
  });

  it('네온 3색(U23)', () => {
    expect(LANE_COLOR).toEqual({ cymbal: '#ffc24a', drum: '#22e4ff', kick: '#ff3ec8' });
    expect(laneColorOf('KICK')).toBe('#ff3ec8');
    expect(laneColorOf('SNARE')).toBe('#22e4ff');
    expect(laneColorOf('HIHAT_PEDAL')).toBe('#ffc24a');
  });

  it('모든 레인 패드가 어느 묶음에든 속한다', () => {
    for (const p of HIGHWAY_LANES) expect(Object.values(LANE_COLOR)).toContain(laneColorOf(p));
  });
});
