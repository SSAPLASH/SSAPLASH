// 정보 카드 겹침 영역 계산 검증(PLAY-004 D10): 행·캔버스·카드 px → 캔버스 정규 영역 / 겹침 없음(null) / 측정 불가(undefined).
import { describe, expect, it } from 'vitest';
import { regionFromSizes, shiftForCard } from './useOverlayRegion';
import { DEFAULT_KIT_LAYOUT, pickOverlayCorner } from '@/domain/kitLayout';

describe('regionFromSizes', () => {
  it('행 폭 − 캔버스 폭 ≥ 카드 폭+24이면 캔버스 옆 여백에 놓여 겹침 없음(null)', () => {
    expect(regionFromSizes({ w: 1100 }, { w: 525, h: 328 }, { w: 220, h: 150 })).toBeNull();
    // 경계: 정확히 244
    expect(regionFromSizes({ w: 769 }, { w: 525, h: 328 }, { w: 220, h: 150 })).toBeNull();
  });
  it('여백이 모자라면 실제 교차 영역을 캔버스 정규 좌표로 돌려준다', () => {
    // 한쪽 여백 100 → 카드가 캔버스로 120px 파고든다
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

describe('shiftForCard', () => {
  it('한쪽 여백이 이미 카드 폭+24 이상이면 비키지 않는다', () => {
    expect(shiftForCard({ w: 1100 }, { w: 525 }, { w: 220 })).toBe(0);
  });
  it('남은 폭은 되지만 한쪽 여백이 모자라면 오른쪽에 그만큼 비운다', () => {
    // 여백 합 400 → 한쪽 200, 필요 244 → p = 488 − 400 = 88
    expect(shiftForCard({ w: 925 }, { w: 525 }, { w: 220 })).toBe(88);
  });
  it('남은 폭이 카드 폭+24보다 작으면 비키지 않는다(겹침 처리)', () => {
    expect(shiftForCard({ w: 725 }, { w: 525 }, { w: 220 })).toBe(0);
  });
});
