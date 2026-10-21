import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT, KIT_LAYOUT_PRESETS } from './kitLayout';
import { ALL_PADS } from './pads';

describe('KIT_LAYOUT_PRESETS', () => {
  it('DEFAULT_KIT_LAYOUT은 basic과 같다', () => {
    expect(DEFAULT_KIT_LAYOUT).toBe(KIT_LAYOUT_PRESETS.basic);
  });

  it('wide는 중심에서 멀어지고 tight는 가까워지며 반지름은 그대로', () => {
    const { basic, wide, tight } = KIT_LAYOUT_PRESETS;
    for (const pad of ALL_PADS) {
      const d = (l: typeof basic) => Math.hypot(l[pad].x - 0.5, l[pad].y - 0.5);
      expect(d(tight)).toBeLessThan(d(basic));
      expect(wide[pad].r).toBe(basic[pad].r);
      expect(tight[pad].r).toBe(basic[pad].r);
    }
    expect(wide.RIDE.x).toBeGreaterThan(basic.RIDE.x);
  });

  it('모든 위치가 0.08~0.92 안', () => {
    for (const layout of Object.values(KIT_LAYOUT_PRESETS)) {
      for (const pad of ALL_PADS) {
        for (const v of [layout[pad].x, layout[pad].y]) {
          expect(v).toBeGreaterThanOrEqual(0.08);
          expect(v).toBeLessThanOrEqual(0.92);
        }
      }
    }
  });
});
