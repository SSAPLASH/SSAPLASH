import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT, fillLayout, overlayCorner, OVERLAY_REGION, pickOverlayCorner } from './kitLayout';
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

describe('overlayCorner', () => {
  it('카드 영역 안에 있는 패드는 left다', () => {
    expect(overlayCorner({ x: 0.9, y: 0.9, r: 0.05 })).toBe('left');
  });

  it('영역 밖이어도 원이 가장자리를 넘어 들어오면 left다', () => {
    // 영역 왼쪽 경계 x=0.8에서 0.05 떨어진 중심, 반지름 0.07
    expect(overlayCorner({ x: 0.75, y: 0.9, r: 0.07 })).toBe('left');
    expect(overlayCorner({ x: 0.75, y: 0.9, r: 0.04 })).toBe('right');
  });

  it('위쪽 경계는 높이를 가로 기준으로 환산해 판정한다', () => {
    // 영역 위쪽 y=0.78에서 0.1 위: 가로 단위로 0.0625
    expect(overlayCorner({ x: 0.9, y: 0.68, r: 0.07 })).toBe('left');
    expect(overlayCorner({ x: 0.9, y: 0.68, r: 0.06 })).toBe('right');
  });

  it('카드 영역 상수는 폭 0.2·높이 0.22다', () => {
    expect(OVERLAY_REGION).toEqual({ w: 0.2, h: 0.22 });
  });
});

describe('pickOverlayCorner', () => {
  const region = { w: 0.3, h: 0.3 };
  const far = { x: 0.5, y: 0.2, r: 0.05 };
  it('겹침 영역이 없으면(null·0) 항상 right', () => {
    expect(pickOverlayCorner({ A: { x: 0.95, y: 0.95, r: 0.1 } }, null, ['A'])).toBe('right');
    expect(pickOverlayCorner({ A: { x: 0.95, y: 0.95, r: 0.1 } }, { w: 0, h: 0.3 }, ['A'])).toBe('right');
  });
  it('가려지는 패드가 더 적은 모서리를 고른다(모든 패드 기준)', () => {
    const layout = { A: { x: 0.9, y: 0.9, r: 0.05 }, B: { x: 0.8, y: 0.85, r: 0.05 }, C: far };
    expect(pickOverlayCorner(layout, region, [])).toBe('left');
  });
  it('같으면 right', () => {
    expect(pickOverlayCorner({ C: far }, region, [])).toBe('right');
  });
  it('지금 칠·선택 패드를 가리는 모서리는 패드 수가 적어도 피한다', () => {
    // 오른쪽 모서리: focus A 1개만 가림 / 왼쪽 모서리: 비집중 패드 2개를 가림
    const layout = { A: { x: 0.9, y: 0.9, r: 0.05 }, B: { x: 0.1, y: 0.9, r: 0.05 }, D: { x: 0.2, y: 0.85, r: 0.05 } };
    expect(pickOverlayCorner(layout, region, ['A'])).toBe('left');
  });
  it('양쪽 모두 focus를 가리면 가려지는 수가 적은 쪽', () => {
    const layout = { A: { x: 0.9, y: 0.9, r: 0.05 }, B: { x: 0.1, y: 0.9, r: 0.05 }, D: { x: 0.2, y: 0.85, r: 0.05 } };
    expect(pickOverlayCorner(layout, region, ['A', 'B'])).toBe('right');
  });
});
