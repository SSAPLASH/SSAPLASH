import { describe, expect, it } from 'vitest';
import {
  DRUM_KIT_H,
  DRUM_KIT_FLAT_PADS,
  DRUM_KIT_PADS,
  KIT_SKINS,
  isKitSkin,
  kitPadsFor,
  DRUM_KIT_W,
  fitScale,
  fitScaleBox,
  padFrameCircle,
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

describe('fitScaleBox (contain)', () => {
  it('폭·높이 하나라도 0 이하면 0', () => {
    expect(fitScaleBox(0, 300, 4)).toBe(0);
    expect(fitScaleBox(760, 0, 4)).toBe(0);
  });
  it('min(maxScale, w/760, h/300)', () => {
    expect(fitScaleBox(1520, 300, 4)).toBe(1); // 높이가 제한
    expect(fitScaleBox(760, 900, 4)).toBe(1); // 폭이 제한
    expect(fitScaleBox(1520, 600, 4)).toBe(2);
    expect(fitScaleBox(5000, 5000, 4)).toBe(4); // 상한
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

describe('kitPadsFor · DRUM_KIT_FLAT_PADS', () => {
  it('세 스킨 모두 8패드를 돌려주고 실물은 기존 표다', () => {
    for (const skin of KIT_SKINS) expect(kitPadsFor(skin)).toHaveLength(8);
    expect(kitPadsFor('acoustic')).toBe(DRUM_KIT_PADS);
    expect(kitPadsFor('electronic')).toBe(DRUM_KIT_FLAT_PADS);
    expect(kitPadsFor('neon')).toBe(DRUM_KIT_FLAT_PADS);
  });

  it('평면 표는 760×300 안에 있고 원끼리 겹치지 않는다(4px 허용)', () => {
    for (const p of DRUM_KIT_FLAT_PADS) {
      expect(p.w).toBe(p.h);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + p.w).toBeLessThanOrEqual(DRUM_KIT_W);
      expect(p.top + p.h).toBeLessThanOrEqual(DRUM_KIT_H);
    }
    for (let i = 0; i < DRUM_KIT_FLAT_PADS.length; i++) {
      for (let j = i + 1; j < DRUM_KIT_FLAT_PADS.length; j++) {
        const a = DRUM_KIT_FLAT_PADS[i];
        const b = DRUM_KIT_FLAT_PADS[j];
        const dist = Math.hypot(a.left + a.w / 2 - (b.left + b.w / 2), a.top + a.h / 2 - (b.top + b.h / 2));
        expect(dist).toBeGreaterThanOrEqual(a.w / 2 + b.w / 2 - 4);
      }
    }
  });

  it('HIHAT_PEDAL이 없고 태그가 모두 있다', () => {
    expect(DRUM_KIT_FLAT_PADS.some((p) => (p.pad as string) === 'HIHAT_PEDAL')).toBe(false);
    expect(DRUM_KIT_FLAT_PADS.every((p) => !!p.tag)).toBe(true);
    expect(DRUM_KIT_FLAT_PADS.map((p) => p.pad)).toEqual(DRUM_KIT_PADS.map((p) => p.pad));
  });

  it('isKitSkin', () => {
    expect(isKitSkin('neon')).toBe(true);
    expect(isKitSkin('weird')).toBe(false);
    expect(isKitSkin(undefined)).toBe(false);
  });
});

describe('placePad / padCenter (PLAY-004)', () => {
  it('placePad로 옮긴 패드의 헤드 중심이 지정한 정규화 좌표에 온다', async () => {
    const { DRUM_KIT_PADS, DRUM_KIT_W, DRUM_KIT_H, padCenter, placePad } = await import('./drumKit');
    const snare = DRUM_KIT_PADS.find((p) => p.pad === 'SNARE')!;
    const moved = placePad(snare, 0.25, 0.8);
    const c = padCenter(moved);
    expect(c.x).toBeCloseTo(0.25 * DRUM_KIT_W);
    expect(c.y).toBeCloseTo(0.8 * DRUM_KIT_H);
    expect(moved.w).toBe(snare.w);
    expect(moved.h).toBe(snare.h);
  });

  it('원래 자리의 중심은 left/top보다 안쪽', async () => {
    const { DRUM_KIT_PADS, padCenter } = await import('./drumKit');
    for (const p of DRUM_KIT_PADS) {
      const c = padCenter(p);
      expect(c.x).toBeGreaterThan(p.left);
      expect(c.y).toBeGreaterThan(p.top);
    }
  });
});

describe('layoutToKitPoint', () => {
  it('가로는 그대로, 세로는 0.15~0.77로 누른다', async () => {
    const { layoutToKitPoint } = await import('./drumKit');
    expect(layoutToKitPoint({ x: 0.3, y: 0 })).toEqual({ x: 0.3, y: 0.15 });
    expect(layoutToKitPoint({ x: 0.3, y: 1 }).y).toBeCloseTo(0.77);
  });
});

describe('padFrameCircle (contain 환산)', () => {
  it('킷이 틀을 폭으로 꽉 채우는 760×300 틀에서는 점 좌표가 그대로고 반지름은 w/2/760', () => {
    const c = padFrameCircle('SNARE', { x: 0.5, y: 0.5 }, 'acoustic', { w: 760, h: 300 });
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
    // S = min(760, 480) = 480, scale 1 → r = w/2/480
    expect(c.r).toBeGreaterThan(0);
  });
  it('가로로 넓은 틀에서는 킷이 가운데에 놓여 x가 안쪽으로 모인다', () => {
    const c = padFrameCircle('SNARE', { x: 0, y: 0.5 }, 'acoustic', { w: 2000, h: 300 });
    expect(c.x).toBeCloseTo((2000 - 760) / 2 / 2000);
  });
});
