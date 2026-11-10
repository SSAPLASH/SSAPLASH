// 판 안 배치 계산 검증(PLAY-004 D10·D11): 판 안쪽 폭·그림·카드 px → 그림 정규 영역 / 겹침 없음(null) / 측정 불가(undefined), 배너 쌓기 offset.
import { describe, expect, it } from 'vitest';
import { bannerBottomOffset, PANEL_PAD, regionFromSizes, STACK_GAP } from './useOverlayRegion';
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

describe('bannerBottomOffset', () => {
  const banner = { left: 300, right: 700 };
  it('카드가 없으면 기본 여백(24px)', () => {
    expect(bannerBottomOffset(banner, null)).toBe(PANEL_PAD);
  });
  it('가로로 안 겹치면 기본 여백', () => {
    expect(bannerBottomOffset(banner, { left: 704, right: 924, h: 150 })).toBe(PANEL_PAD);
    expect(bannerBottomOffset(banner, { left: 700, right: 920, h: 150 })).toBe(PANEL_PAD); // 맞닿기만 하면 겹침 아님
  });
  it('가로로 겹치면 카드 위로 쌓는다(카드 높이 + 12px)', () => {
    expect(bannerBottomOffset(banner, { left: 600, right: 820, h: 150 })).toBe(PANEL_PAD + 150 + STACK_GAP);
  });
  it('왼쪽 모서리 카드와도 같은 규칙', () => {
    expect(bannerBottomOffset(banner, { left: 24, right: 244, h: 100 })).toBe(PANEL_PAD);
    expect(bannerBottomOffset(banner, { left: 200, right: 420, h: 100 })).toBe(PANEL_PAD + 100 + STACK_GAP);
  });
});
