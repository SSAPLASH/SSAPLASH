// 판 안 배치 계산 검증(PLAY-004 D10·D11): 판 안쪽 폭·그림·카드 px → 그림 정규 영역 / 겹침 없음(null) / 측정 불가(undefined), 배너 쌓기 offset.
import { describe, expect, it } from 'vitest';
import { bannerPlacement, PANEL_PAD, regionFromSizes, STACK_GAP } from './useOverlayRegion';
import { DEFAULT_KIT_LAYOUT, pickOverlayCorner } from '@/domain/kitLayout';

describe('regionFromSizes', () => {
  it('그림 옆 한쪽 여백이 카드 폭+24 이상이면 카드가 그림 옆에 놓여 겹침 없음(null)', () => {
    expect(regionFromSizes({ w: 1100 }, { w: 525, h: 328 }, { w: 220, h: 150 })).toBeNull();
    // 경계: 한쪽 여백이 정확히 244(525 + 2×244 = 1013)
    expect(regionFromSizes({ w: 1013 }, { w: 525, h: 328 }, { w: 220, h: 150 })).toBeNull();
  });
  it('한쪽 여백이 카드 폭 이상이면 맞닿지 않아 겹침 없음(null)', () => {
    expect(regionFromSizes({ w: 965 }, { w: 525, h: 328 }, { w: 220, h: 150 })).toBeNull(); // 여백 220
  });
  it('여백이 모자라면 실제 교차 영역을 그림 정규 좌표로 돌려준다', () => {
    // 한쪽 여백 100 → 카드가 그림으로 120px 파고든다
    const r = regionFromSizes({ w: 725 }, { w: 525, h: 328 }, { w: 220, h: 150 });
    expect(r?.w).toBeCloseTo(120 / 525);
    expect(r?.h).toBeCloseTo(150 / 328);
  });
  it('1을 넘지 않는다', () => {
    expect(regionFromSizes({ w: 200 }, { w: 200, h: 100 }, { w: 220, h: 300 })).toEqual({ w: 1, h: 1 });
  });
  it('크기가 0이면 측정 불가(undefined)', () => {
    expect(regionFromSizes({ w: 0 }, { w: 0, h: 0 }, { w: 220, h: 100 })).toBeUndefined();
    expect(regionFromSizes({ w: 500 }, { w: 300, h: 200 }, { w: 0, h: 0 })).toBeUndefined();
  });
  it('겹침 영역이 있으면 고정 비율보다 일찍 모서리를 바꾼다', () => {
    const region = regionFromSizes({ w: 600 }, { w: 525, h: 328 }, { w: 220, h: 150 })!;
    expect(pickOverlayCorner({ SNARE: { x: 0.7, y: 0.85, r: 0.04 } }, region, ['SNARE'])).toBe('left');
  });
  it('겹침 없음(null)이면 항상 right', () => {
    expect(pickOverlayCorner({ SNARE: { x: 0.95, y: 0.95, r: 0.1 } }, null, ['SNARE'])).toBe('right');
    expect(pickOverlayCorner(DEFAULT_KIT_LAYOUT, { w: 0, h: 0 }, [])).toBe('right');
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
