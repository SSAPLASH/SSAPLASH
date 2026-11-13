// 판 안 배치 계산 검증(PLAY-004 D10·D11): 판 안쪽 폭·그림·카드 px → 그림 정규 영역 / 겹침 없음(null) / 측정 불가(undefined), 배너 쌓기 offset.
import { describe, expect, it } from 'vitest';
import { bannerPlacement, PANEL_PAD, regionFromSizes, STACK_GAP } from './useOverlayRegion';
import { DEFAULT_KIT_LAYOUT, pickOverlayCorner } from '@/domain/kit/kitLayout';

describe('regionFromSizes', () => {
  it('카드가 그림 영역에서 차지하는 비율을 그림 정규 좌표로 돌려준다(항상 겹침)', () => {
    const r = regionFromSizes({ w: 1000, h: 625 }, { w: 220, h: 150 });
    expect(r?.w).toBeCloseTo(0.22);
    expect(r?.h).toBeCloseTo(0.24);
  });
  it('1을 넘지 않는다', () => {
    expect(regionFromSizes({ w: 200, h: 100 }, { w: 220, h: 300 })).toEqual({ w: 1, h: 1 });
  });
  it('크기가 0이면 측정 불가(undefined)', () => {
    expect(regionFromSizes({ w: 0, h: 0 }, { w: 220, h: 100 })).toBeUndefined();
    expect(regionFromSizes({ w: 500, h: 300 }, { w: 0, h: 0 })).toBeUndefined();
  });
  it('겹침 영역이 있으면 모서리를 판정한다', () => {
    const region = regionFromSizes({ w: 600, h: 375 }, { w: 220, h: 150 })!;
    expect(pickOverlayCorner({ SNARE: { x: 0.8, y: 0.85, r: 0.04 } }, region, ['SNARE'])).toBe('left');
  });
  it('카드가 없으면(null) 항상 right', () => {
    expect(pickOverlayCorner({ SNARE: { x: 0.95, y: 0.95, r: 0.1 } }, null, ['SNARE'])).toBe('right');
    expect(pickOverlayCorner(DEFAULT_KIT_LAYOUT, { w: 0, h: 0 }, [])).toBe('right');
  });
  it('넓은 판은 반지름이 높이×1.6 기준이라 같은 정규 r이 덜 가린다', () => {
    // 오른쪽 모서리 영역 x 0.7~1, y 0.7~1. 패드 (0.6, 0.85, r 0.12): 16:10이면 가림(0.1×16=1.6 < 1.92), 3:1 판이면 S=H×1.6이라 안 가림
    const layout = { A: { x: 0.6, y: 0.85, r: 0.12 } };
    const region = { w: 0.3, h: 0.3 };
    expect(pickOverlayCorner(layout, region, ['A'])).toBe('left');
    expect(pickOverlayCorner(layout, region, ['A'], { w: 3000, h: 1000 })).toBe('right');
  });
});

describe('bannerPlacement', () => {
  // 판 폭 1000, 배너 폭 500 → 가운데 자리 left 250 ~ 750
  it('카드가 없거나 가운데 자리와 안 겹치면 가운데·기본 여백', () => {
    expect(bannerPlacement(1000, 500, null)).toEqual({ left: 250, bottom: PANEL_PAD });
    expect(bannerPlacement(1000, 500, { left: 750, right: 976, h: 150 })).toEqual({ left: 250, bottom: PANEL_PAD }); // 맞닿기만 하면 겹침 아님
  });
  it('오른쪽 카드와 겹치면 왼쪽으로 비켜 같은 줄에 둔다', () => {
    expect(bannerPlacement(1000, 500, { left: 700, right: 976, h: 150 })).toEqual({ left: 700 - STACK_GAP - 500, bottom: PANEL_PAD });
  });
  it('왼쪽 카드와 겹치면 오른쪽으로 비킨다', () => {
    expect(bannerPlacement(1000, 500, { left: 24, right: 300, h: 150 })).toEqual({ left: 300 + STACK_GAP, bottom: PANEL_PAD });
  });
  it('비킬 자리가 없으면 가운데에서 카드 위로 쌓는다', () => {
    expect(bannerPlacement(800, 500, { left: 500, right: 776, h: 150 })).toEqual({ left: 150, bottom: PANEL_PAD + 150 + STACK_GAP });
  });
});
