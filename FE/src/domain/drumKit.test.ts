import { describe, expect, it } from 'vitest';
import {
  DRUM_KIT_H,
  DRUM_KIT_PADS,
  DRUM_KIT_W,
  fitScale,
  kitSizeAt,
  labelFontSize,
  visualPadOf,
} from './drumKit';

describe('DRUM_KIT_PADS (설계 3-3 표)', () => {
  it('8개이고 순서가 겹침 순서(뒤 → 앞)다', () => {
    expect(DRUM_KIT_PADS.map((p) => p.pad)).toEqual([
      'CRASH', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'HIHAT', 'KICK', 'SNARE', 'FLOOR_TOM',
    ]);
  });

  it('HIHAT_PEDAL 패드는 없다', () => {
    expect(DRUM_KIT_PADS.some((p) => (p.pad as string) === 'HIHAT_PEDAL')).toBe(false);
  });

  it('shape·좌표·크기·라벨이 표와 같다', () => {
    const table = [
      ['CRASH', 'cymbal', 60, 0, 150, 140.6, '크래시'],
      ['RIDE', 'cymbal', 590, 0, 160, 150, '라이드'],
      ['SMALL_TOM', 'drum', 235, 6, 120, 112.5, '탐1'],
      ['MID_TOM', 'drum', 405, 6, 120, 112.5, '탐2'],
      ['HIHAT', 'cymbal', 20, 110, 130, 121.9, '하이햇'],
      ['KICK', 'kick', 310, 118, 140, 148.8, '킥'],
      ['SNARE', 'drum', 180, 140, 150, 140.6, '스네어'],
      ['FLOOR_TOM', 'drum', 520, 130, 170, 159.4, '플로어탐'],
    ];
    expect(DRUM_KIT_PADS.map((p) => [p.pad, p.shape, p.left, p.top, p.w, p.h, p.label])).toEqual(table);
  });

  it('모든 패드가 760×300 킷 안에 들어간다', () => {
    for (const p of DRUM_KIT_PADS) {
      expect(p.left + p.w).toBeLessThanOrEqual(DRUM_KIT_W);
      expect(p.top + p.h).toBeLessThanOrEqual(DRUM_KIT_H);
    }
  });
});

describe('labelFontSize', () => {
  it('12px × (w / 160)', () => {
    expect(labelFontSize(160)).toBe(12);
    expect(labelFontSize(80)).toBe(6);
    expect(labelFontSize(150)).toBeCloseTo(11.25);
  });
});

describe('kitSizeAt', () => {
  it('scale 1은 760×300', () => {
    expect(kitSizeAt(1)).toEqual({ width: 760, height: 300 });
  });

  it('scale 0.7은 532×210', () => {
    const { width, height } = kitSizeAt(0.7);
    expect(width).toBeCloseTo(532);
    expect(height).toBeCloseTo(210);
  });
});

describe('fitScale', () => {
  it('폭이 0 이하면 0', () => {
    expect(fitScale(0, 1)).toBe(0);
    expect(fitScale(-100, 1)).toBe(0);
    expect(fitScale(Number.NaN, 1)).toBe(0);
  });

  it('min(maxScale, w / 760)', () => {
    expect(fitScale(380, 1)).toBeCloseTo(0.5);
    expect(fitScale(760, 1)).toBe(1);
    expect(fitScale(1520, 1)).toBe(1);
    expect(fitScale(1520, 2)).toBe(2);
    expect(fitScale(532, 1)).toBeCloseTo(0.7);
  });
});

describe('visualPadOf', () => {
  it('HIHAT_PEDAL은 HIHAT에 표시한다', () => {
    expect(visualPadOf('HIHAT_PEDAL')).toBe('HIHAT');
  });

  it('그 외 패드는 그대로', () => {
    expect(visualPadOf('SNARE')).toBe('SNARE');
    expect(visualPadOf('KICK')).toBe('KICK');
  });
});
