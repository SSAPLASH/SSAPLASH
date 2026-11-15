import { describe, expect, it } from 'vitest';
import { SHEET_CHROME_H, SHEET_KIT_MAX_H, SHEET_KIT_MIN_H, sheetAreaMax, sheetAreaWant, sheetKitFit } from './sheetKitFit';
import { OVERLAY_RESERVE_PX, STAFF_SCALE_WIDE_MAX, staffScale, staffScaleMax } from '@/features/play/components/stage/sheet/sheetPagerMath';

describe('sheetKitFit (악보 연습 킷 상자, 설계 MODE-003-practice-speed D18·D20)', () => {
  it('악보 칸의 최대 높이는 그 폭에서 악보가 가장 크게 그려지는 높이다(넓은 화면 422)', () => {
    expect(sheetAreaMax(1629)).toBe(422);
    expect(sheetAreaMax(1280)).toBeLessThan(422);
    for (const vw of [1024, 1280, 1629, 1920, 2560]) {
      const areaW = vw - 48;
      expect(staffScale(sheetAreaMax(vw) - OVERLAY_RESERVE_PX, areaW)).toBe(staffScaleMax(areaW));
    }
    expect(staffScaleMax(1629 - 48)).toBe(STAFF_SCALE_WIDE_MAX);
  });

  it('악보 칸은 남는 높이의 43 %를 갖는다: 최소 274, 최대는 그 폭의 최대 높이', () => {
    expect(SHEET_CHROME_H).toBe(217);
    expect(sheetAreaWant(1280, 860)).toBe(276);
    expect(sheetAreaWant(1024, 768)).toBe(274);
    expect(sheetAreaWant(1920, 1080)).toBe(371);
    expect(sheetAreaWant(1629, 1282)).toBe(422);
  });

  it('킷은 그 나머지다(1280×860 → 367, 1920×1080 → 492)', () => {
    expect(sheetKitFit(1280, 860)).toEqual({ width: 640, height: 367 });
    expect(sheetKitFit(1024, 768).height).toBe(277);
    expect(sheetKitFit(1920, 1080).height).toBe(492);
  });

  it('높이는 210~640으로 자른다: 낮은 화면은 예전 크기, 아주 높은 화면은 640(그 뒤로 남는 높이는 악보 칸이 갖는다)', () => {
    expect(sheetKitFit(1280, 600).height).toBe(SHEET_KIT_MIN_H);
    expect(sheetKitFit(1280, 701).height).toBe(210);
    expect(sheetKitFit(1629, 1282).height).toBe(SHEET_KIT_MAX_H);
    expect(sheetKitFit(2560, 1440).height).toBe(SHEET_KIT_MAX_H);
  });

  it('폭은 양옆 칸(280 + 간격 16)과 좌우 여백을 뺀 나머지이고 음수가 되지 않는다', () => {
    expect(sheetKitFit(1024, 768).width).toBe(384);
    expect(sheetKitFit(500, 768).width).toBe(0);
  });
});
