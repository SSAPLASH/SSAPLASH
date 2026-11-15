import { describe, expect, it } from 'vitest';
import {
  DRUM_KIT_H,
  DRUM_KIT_FLAT_PADS,
  DRUM_KIT_PADS,
  DRUM_KIT_PADS_TOP,
  PLAY_KIT_TOP_H,
  SHEET_KIT_TOP_H,
  smallKitSpec,
  KIT_SKINS,
  isKitSkin,
  kitBoxFor,
  kitPadsFor,
  DRUM_KIT_W,
  fitScale,
  fitScaleBox,
  kitSizeAt,
  labelFontSize,
  visualPadOf,
} from './drumKit';
import { KIT_ART_PERSP, KIT_ART_TOP, kitArtPad } from './kitArt';
import { PAD_META } from './pads';

describe('DRUM_KIT_PADS (실물 스킨 고정 배치)', () => {
  it('9개이고 순서가 겹침 순서(뒤 → 앞)다', () => {
    expect(DRUM_KIT_PADS.map((p) => p.pad)).toEqual([
      'CRASH', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'KICK', 'HIHAT', 'SNARE', 'FLOOR_TOM', 'HIHAT_PEDAL',
    ]);
  });

  it('모양·자리·크기가 그림 자리 표(kitArt)에서 온다', () => {
    for (const p of DRUM_KIT_PADS) {
      const art = kitArtPad(KIT_ART_PERSP, p.pad);
      expect(p.art).toBe(art);
      expect([p.shape, p.left, p.top, p.w]).toEqual([art?.shape, art?.kit.left, art?.kit.top, art?.kit.w]);
      expect(p.h).toBeCloseTo((p.w * (art?.boxH ?? 0)) / 160);
    }
  });

  it('모든 패드가 실물 킷 상자 안에 들어간다', () => {
    const box = kitBoxFor('acoustic');
    for (const p of DRUM_KIT_PADS) {
      expect(p.left + p.w).toBeLessThanOrEqual(box.w);
      expect(p.top + p.h).toBeLessThanOrEqual(box.h);
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
  it('전자·네온: scale 1은 760×300', () => {
    expect(kitSizeAt(1, 'electronic')).toEqual({ width: 760, height: 300 });
    expect(kitSizeAt(1, 'neon')).toEqual({ width: 760, height: 300 });
  });

  it('전자·네온: scale 0.7은 532×210', () => {
    const { width, height } = kitSizeAt(0.7, 'neon');
    expect(width).toBeCloseTo(532);
    expect(height).toBeCloseTo(210);
  });

  it('실물: 폭은 같고 높이는 그림의 킷 상자를 따른다', () => {
    const box = kitBoxFor('acoustic');
    expect(box).toBe(KIT_ART_PERSP.box);
    expect(box.w).toBe(760);
    expect(box.h).toBeGreaterThan(DRUM_KIT_H);
    expect(kitSizeAt(0.5, 'acoustic')).toEqual({ width: 380, height: box.h * 0.5 });
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
  it('킷 상자 높이를 주면 그 높이로 맞춘다(실물)', () => {
    expect(fitScaleBox(1520, 600, 4, 600)).toBe(1);
    expect(fitScaleBox(1520, 300, 4, 600)).toBe(0.5);
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
  it('실물은 하이햇 페달까지 9패드, 전자·네온은 8패드를 돌려준다', () => {
    expect(kitPadsFor('acoustic')).toHaveLength(9);
    for (const skin of KIT_SKINS.filter((s) => s !== 'acoustic')) expect(kitPadsFor(skin)).toHaveLength(8);
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
    const stickAndKick = DRUM_KIT_PADS.map((p) => p.pad).filter((pad) => pad !== 'HIHAT_PEDAL');
    expect(DRUM_KIT_FLAT_PADS.map((p) => p.pad).sort()).toEqual(stickAndKick.sort());
  });

  it('isKitSkin', () => {
    expect(isKitSkin('neon')).toBe(true);
    expect(isKitSkin('weird')).toBe(false);
    expect(isKitSkin(undefined)).toBe(false);
  });
});

describe('placePad / padCenter (PLAY-004)', () => {
  it('placePad로 옮긴 패드의 헤드 중심이 지정한 정규화 좌표에 온다', async () => {
    const { DRUM_KIT_PADS, DRUM_KIT_W, kitBoxFor, padCenter, placePad } = await import('./drumKit');
    const snare = DRUM_KIT_PADS.find((p) => p.pad === 'SNARE')!;
    const boxH = kitBoxFor('acoustic').h;
    const moved = placePad(snare, 0.25, 0.8, boxH);
    const c = padCenter(moved);
    expect(c.x).toBeCloseTo(0.25 * DRUM_KIT_W);
    expect(c.y).toBeCloseTo(0.8 * boxH);
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

describe('이름 출처 통일(PAD_META)', () => {
  it('실물 키트 라벨은 PAD_META.label과 같다', () => {
    for (const p of DRUM_KIT_PADS) expect(p.label).toBe(PAD_META[p.pad].label);
  });

  it('평면 키트 라벨·태그는 PAD_META의 label·short와 같다(탐은 ST·MT)', () => {
    for (const p of DRUM_KIT_FLAT_PADS) {
      expect(p.label).toBe(PAD_META[p.pad].label);
      expect(p.tag).toBe(PAD_META[p.pad].short);
    }
    const tags = Object.fromEntries(DRUM_KIT_FLAT_PADS.map((p) => [p.pad, p.tag]));
    expect(tags.SMALL_TOM).toBe('ST');
    expect(tags.MID_TOM).toBe('MT');
  });
});
describe('view(위에서 본 그림)', () => {
  it('kitBoxFor: 실물은 view에 따라 상자가 다르고, 전자·네온은 view를 무시한다', () => {
    expect(kitBoxFor('acoustic')).toBe(KIT_ART_PERSP.box);
    expect(kitBoxFor('acoustic', 'persp')).toBe(KIT_ART_PERSP.box);
    expect(kitBoxFor('acoustic', 'top')).toBe(KIT_ART_TOP.box);
    for (const skin of ['electronic', 'neon'] as const) {
      expect(kitBoxFor(skin, 'top')).toEqual({ w: DRUM_KIT_W, h: DRUM_KIT_H });
    }
  });

  it('kitPadsFor: 실물 top은 위에서 본 그림의 9패드, 전자·네온은 view와 무관', () => {
    expect(kitPadsFor('acoustic', 'top')).toBe(DRUM_KIT_PADS_TOP);
    expect(kitPadsFor('acoustic', 'persp')).toBe(DRUM_KIT_PADS);
    expect(DRUM_KIT_PADS_TOP).toHaveLength(9);
    for (const p of DRUM_KIT_PADS_TOP) expect(p.art, p.pad).toBe(kitArtPad(KIT_ART_TOP, p.pad));
    expect(kitPadsFor('neon', 'top')).toBe(DRUM_KIT_FLAT_PADS);
    expect(kitPadsFor('electronic', 'top')).toBe(DRUM_KIT_FLAT_PADS);
  });

  it('위에서 본 고정 배치의 패드가 모두 킷 상자 안에 들어간다', () => {
    const box = kitBoxFor('acoustic', 'top');
    for (const p of DRUM_KIT_PADS_TOP) {
      expect(p.left + p.w, p.pad).toBeLessThanOrEqual(box.w);
      expect(p.top + p.h, p.pad).toBeLessThanOrEqual(box.h);
    }
  });

  it('kitSizeAt: 실물 top은 760×650.7 × scale', () => {
    expect(kitSizeAt(0.5, 'acoustic', 'top')).toEqual({ width: 380, height: 650.7 * 0.5 });
    expect(kitSizeAt(0.5, 'acoustic')).toEqual(kitSizeAt(0.5, 'acoustic', 'persp'));
    expect(kitSizeAt(0.5, 'neon', 'top')).toEqual({ width: 380, height: 150 });
  });
});

describe('smallKitSpec (작은 연주 킷)', () => {
  it('실물 · 리듬 게임: 위에서 본 그림, 높이 200(폭 약 233.6)', () => {
    const { view, scale } = smallKitSpec('play', 'acoustic');
    expect(view).toBe('top');
    const size = kitSizeAt(scale, 'acoustic', view);
    expect(Math.abs(size.height - 200)).toBeLessThan(0.5);
    expect(size.height).toBeCloseTo(PLAY_KIT_TOP_H);
    expect(size.width).toBeCloseTo(233.6, 0);
  });

  it('실물 · 악보 연습: 위에서 본 그림, 높이 210(폭 약 245.2)', () => {
    const { view, scale } = smallKitSpec('sheet', 'acoustic');
    expect(view).toBe('top');
    const size = kitSizeAt(scale, 'acoustic', view);
    expect(Math.abs(size.height - 210)).toBeLessThan(0.5);
    expect(size.height).toBeCloseTo(SHEET_KIT_TOP_H);
    expect(size.width).toBeCloseTo(245.3, 0);
  });

  it('fit(쓸 수 있는 상자)을 주면 그 상자에 들어가는 만큼 키운다: 실물은 높이, 전자·네온은 폭이 먼저 닿는다', () => {
    const top = smallKitSpec('sheet', 'acoustic', { width: 640, height: 369 });
    const topSize = kitSizeAt(top.scale, 'acoustic', top.view);
    expect(top.view).toBe('top');
    expect(topSize.height).toBeCloseTo(369);
    expect(topSize.width).toBeLessThanOrEqual(640);
    const flat = smallKitSpec('sheet', 'neon', { width: 640, height: 369 });
    const flatSize = kitSizeAt(flat.scale, 'neon', flat.view);
    expect(flatSize.width).toBeCloseTo(640);
    expect(flatSize.height).toBeLessThanOrEqual(369);
  });

  it('fit이 기본 크기보다 작으면 기본 크기를 지킨다(킷은 줄지 않는다)', () => {
    expect(smallKitSpec('sheet', 'acoustic', { width: 100, height: 100 })).toEqual(smallKitSpec('sheet', 'acoustic'));
    expect(smallKitSpec('sheet', 'neon', { width: 384, height: 285 })).toEqual({ view: 'persp', scale: 0.7 });
    expect(smallKitSpec('sheet', 'electronic', { width: 0, height: 210 })).toEqual({ view: 'persp', scale: 0.7 });
  });

  it('전자·네온은 기존 그대로(게임 0.5 · 악보 0.7, persp)', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      expect(smallKitSpec('play', skin)).toEqual({ view: 'persp', scale: 0.5 });
      expect(smallKitSpec('sheet', skin)).toEqual({ view: 'persp', scale: 0.7 });
      expect(kitSizeAt(0.5, skin).height).toBeCloseTo(150);
      expect(kitSizeAt(0.7, skin).height).toBeCloseTo(210);
    }
  });
});
