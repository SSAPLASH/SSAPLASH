import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT, fillLayout } from './kitLayout';
import { ALL_PADS } from './pads';

describe('DEFAULT_KIT_LAYOUT', () => {
  it('패드 9개 전부, 위치는 0.05~0.95 안', () => {
    expect(Object.keys(DEFAULT_KIT_LAYOUT).sort()).toEqual([...ALL_PADS].sort());
    for (const pad of ALL_PADS) {
      for (const v of [DEFAULT_KIT_LAYOUT[pad].x, DEFAULT_KIT_LAYOUT[pad].y]) {
        expect(v).toBeGreaterThanOrEqual(0.05);
        expect(v).toBeLessThanOrEqual(0.95);
      }
    }
  });
});

describe('fillLayout', () => {
  it('없는 패드는 기본 배치 값으로 채운다', () => {
    const l = fillLayout({ SNARE: { x: 0.1, y: 0.2, r: 0.3 } });
    expect(l.SNARE).toEqual({ x: 0.1, y: 0.2, r: 0.3 });
    expect(l.MID_TOM).toEqual(DEFAULT_KIT_LAYOUT.MID_TOM);
    expect(l.HIHAT_PEDAL).toEqual(DEFAULT_KIT_LAYOUT.HIHAT_PEDAL);
    expect(Object.keys(l).sort()).toEqual([...ALL_PADS].sort());
  });
});
