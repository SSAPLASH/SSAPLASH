import { describe, expect, it } from 'vitest';
import { COMBO_BREAK_MIN, COMBO_BURST, COMBO_PULSE_EVERY, COMBO_SHOW, comboStage, isComboBurst } from './comboFx';

describe('comboStage', () => {
  it('상수는 설계 3-1 그대로', () => {
    expect([COMBO_SHOW, COMBO_PULSE_EVERY, COMBO_BREAK_MIN]).toEqual([2, 10, 10]);
    expect(COMBO_BURST).toEqual([50, 100]);
  });

  it('콤보 1 이하는 숨김, 2부터 show', () => {
    expect(comboStage(0, 1, 'PERFECT')).toBe('hide');
    expect(comboStage(1, 2, 'PERFECT')).toBe('show');
    expect(comboStage(2, 3, 'GOOD')).toBe('show');
  });

  it('10의 배수는 pulse', () => {
    expect(comboStage(9, 10, 'PERFECT')).toBe('pulse');
    expect(comboStage(19, 20, 'GOOD')).toBe('pulse');
    expect(comboStage(39, 40, 'PERFECT')).toBe('pulse');
  });

  it('50·100·그 뒤 50의 배수는 burst(pulse보다 우선)', () => {
    expect(comboStage(49, 50, 'PERFECT')).toBe('burst');
    expect(comboStage(99, 100, 'PERFECT')).toBe('burst');
    expect(comboStage(149, 150, 'PERFECT')).toBe('burst');
    expect(comboStage(199, 200, 'GOOD')).toBe('burst');
    expect(comboStage(109, 110, 'PERFECT')).toBe('pulse');
    expect(isComboBurst(75)).toBe(false);
  });

  it('MISS: 직전 콤보가 10 이상이면 break, 미만이면 조용히 숨김', () => {
    expect(comboStage(10, 0, 'MISS')).toBe('break');
    expect(comboStage(57, 0, 'MISS')).toBe('break');
    expect(comboStage(9, 0, 'MISS')).toBe('hide');
    expect(comboStage(0, 0, 'MISS')).toBe('hide');
  });

  it('바뀐 것이 없으면 none', () => {
    expect(comboStage(5, 5, 'GOOD')).toBe('none');
  });
});
