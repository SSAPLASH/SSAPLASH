import { describe, expect, it } from 'vitest';
import { ALL_PADS, LANE_PADS, PAD_META, STICK_PADS, normalizePadId, normalizePadKeys } from './pads';

describe('패드 목록', () => {
  it('ALL 9개·LANE 9개·STICK 7개', () => {
    expect(ALL_PADS).toHaveLength(9);
    expect(LANE_PADS).toHaveLength(9);
    expect(STICK_PADS).toHaveLength(7);
    expect(Object.keys(PAD_META).sort()).toEqual([...ALL_PADS].sort());
  });

  it('포함 관계: STICK ⊂ LANE, LANE은 ALL과 같은 집합이고 HIHAT_PEDAL을 포함한다', () => {
    for (const p of STICK_PADS) expect(LANE_PADS).toContain(p);
    expect([...LANE_PADS].sort()).toEqual([...ALL_PADS].sort());
    expect(LANE_PADS).toContain('HIHAT_PEDAL');
    expect(STICK_PADS).not.toContain('KICK');
    expect(STICK_PADS).not.toContain('HIHAT_PEDAL');
  });

  it('레인 순서: 하이햇 페달은 하이햇 왼쪽', () => {
    expect(LANE_PADS).toEqual(['CRASH', 'HIHAT_PEDAL', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'KICK']);
  });

  it('저장·통계 순서(ALL_PADS)는 바뀌지 않는다', () => {
    expect(ALL_PADS).toEqual(['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'KICK', 'HIHAT_PEDAL']);
  });
});

describe('normalizePadId', () => {
  it('옛 이름 HI_TOM은 SMALL_TOM으로', () => {
    expect(normalizePadId('HI_TOM')).toBe('SMALL_TOM');
  });

  it('현재 이름은 그대로', () => {
    expect(normalizePadId('SMALL_TOM')).toBe('SMALL_TOM');
    expect(normalizePadId('HIHAT_PEDAL')).toBe('HIHAT_PEDAL');
  });

  it('빈 문자열·소문자·모르는 이름은 null', () => {
    expect(normalizePadId('')).toBeNull();
    expect(normalizePadId('snare')).toBeNull();
    expect(normalizePadId('COWBELL')).toBeNull();
    expect(normalizePadId('toString')).toBeNull();
  });
});

describe('normalizePadKeys', () => {
  it('HI_TOM 키를 SMALL_TOM으로 바꾼다', () => {
    expect(normalizePadKeys({ HI_TOM: 1, SNARE: 2 })).toEqual({ SMALL_TOM: 1, SNARE: 2 });
  });

  it('모르는 키는 버린다', () => {
    expect(normalizePadKeys({ COWBELL: 1, KICK: 3 })).toEqual({ KICK: 3 });
  });

  it('HI_TOM과 SMALL_TOM이 같이 있으면 SMALL_TOM 값이 이긴다', () => {
    expect(normalizePadKeys({ HI_TOM: 1, SMALL_TOM: 2 })).toEqual({ SMALL_TOM: 2 });
    expect(normalizePadKeys({ SMALL_TOM: 2, HI_TOM: 1 })).toEqual({ SMALL_TOM: 2 });
  });
});
