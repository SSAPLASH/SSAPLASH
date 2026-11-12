import { describe, expect, it } from 'vitest';
import { ALL_PADS, type PadId } from '../pads';
import { KIT_ART_PERSP, kitArtPad, type KitArtPad } from './kitArt';

const art = KIT_ART_PERSP;
const of = (pad: PadId): KitArtPad => {
  const p = kitArtPad(art, pad);
  if (!p) throw new Error(`${pad} 항목이 없다`);
  return p;
};
/** 헤드 중심(킷 단위) */
const center = (pad: PadId) => {
  const p = of(pad);
  const s = p.kit.w / 160;
  return { x: p.kit.left + p.head.cx * s, y: p.kit.top + p.head.cy * s };
};

describe('실물 드럼 자리 표(원근 그림)', () => {
  it('패드 9개가 한 번씩 있다', () => {
    expect(art.pads.map((p) => p.pad).sort()).toEqual([...ALL_PADS].sort());
  });

  it('조각 이미지 이름이 겹치지 않는다', () => {
    const names = art.pads.flatMap((p) => (p.top ? [p.sprite, p.top.sprite] : [p.sprite]));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(10);
  });

  it('헤드 타원이 조각 상자 안에 있다', () => {
    for (const p of art.pads) {
      expect(p.head.cx - p.head.rx, p.pad).toBeGreaterThanOrEqual(-1);
      expect(p.head.cx + p.head.rx, p.pad).toBeLessThanOrEqual(161);
      expect(p.head.cy - p.head.ry, p.pad).toBeGreaterThanOrEqual(-1);
      expect(p.head.cy + p.head.ry, p.pad).toBeLessThanOrEqual(p.boxH + 1);
    }
  });

  it('링은 헤드와 중심이 같고 헤드보다 크다', () => {
    for (const p of art.pads) {
      expect(p.ring.cx, p.pad).toBe(p.head.cx);
      expect(p.ring.cy, p.pad).toBe(p.head.cy);
      expect(p.ring.rx, p.pad).toBeGreaterThan(p.head.rx);
      expect(p.ring.ry, p.pad).toBeGreaterThan(p.head.ry);
    }
  });

  it('조각 상자가 킷 상자 안에 있다', () => {
    expect(art.box.w).toBe(760);
    for (const p of art.pads) {
      expect(p.kit.left, p.pad).toBeGreaterThanOrEqual(0);
      expect(p.kit.left + p.kit.w, p.pad).toBeLessThanOrEqual(art.box.w);
      expect(p.kit.top, p.pad).toBeGreaterThanOrEqual(0);
      expect(p.kit.top + (p.kit.w * p.boxH) / 160, p.pad).toBeLessThanOrEqual(art.box.h);
    }
  });

  it('윗줄은 왼쪽부터 크래시·스몰탐·미드탐·라이드다', () => {
    const xs = (['CRASH', 'SMALL_TOM', 'MID_TOM', 'RIDE'] as const).map((pad) => center(pad).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('가운데 줄은 왼쪽부터 하이햇·스네어·킥·플로어탐이고 윗줄보다 아래다', () => {
    const middle = ['HIHAT', 'SNARE', 'KICK', 'FLOOR_TOM'] as const;
    const xs = middle.map((pad) => center(pad).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const topRowBottom = Math.max(...(['CRASH', 'SMALL_TOM', 'MID_TOM', 'RIDE'] as const).map((pad) => center(pad).y));
    for (const pad of middle) expect(center(pad).y, pad).toBeGreaterThan(topRowBottom);
  });

  it('하이햇 페달은 하이햇 바로 아래에 있고 맨 앞에 그린다', () => {
    const hihat = of('HIHAT');
    const pedal = center('HIHAT_PEDAL');
    expect(pedal.y).toBeGreaterThan(center('HIHAT').y);
    expect(pedal.x).toBeGreaterThan(hihat.kit.left);
    expect(pedal.x).toBeLessThan(hihat.kit.left + hihat.kit.w);
    expect(art.pads[art.pads.length - 1]?.pad).toBe('HIHAT_PEDAL');
  });

  it('윗판 조각은 하이햇에만 있고, 닫힘 이동은 헤드 세로 반지름보다 작다', () => {
    expect(art.pads.filter((p) => p.top).map((p) => p.pad)).toEqual(['HIHAT']);
    const { top, head } = of('HIHAT');
    expect(top?.closeDy).toBeGreaterThan(0);
    expect(top?.closeDy).toBeLessThan(head.ry);
  });

  it('모양은 심벌 3·드럼 4·킥 1·페달 1이다', () => {
    const count = (shape: string) => art.pads.filter((p) => p.shape === shape).length;
    expect([count('cymbal'), count('drum'), count('kick'), count('pedal')]).toEqual([3, 4, 1, 1]);
  });
});
