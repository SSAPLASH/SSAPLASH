import { describe, expect, it } from 'vitest';
import type { BarLayout } from '@/domain/song/sheet';
import { noteHeadAt, type PagerSlot } from './sheetPagerMath';
import { xInBar, xInBarContinuous } from '@/components/sheetmusic/sheetStripMath';

const layouts: Record<number, BarLayout> = {
  0: { glyphs: [{ noteIndex: 0, xRatio: 0, line: 4 }, { noteIndex: 1, xRatio: 0.5, line: 8 }] },
  1: { glyphs: [{ noteIndex: 2, xRatio: 0.25, line: 2 }] },
  2: { glyphs: [{ noteIndex: 3, xRatio: 0, line: 6 }] },
} as unknown as Record<number, BarLayout>;
const layoutOf = (bar: number) => layouts[bar] ?? ({ glyphs: [] } as unknown as BarLayout);
const base = { layoutOf, slotX: (i: number) => 44 + i * 200, slotW: 200, lineY: (line: number) => 150 - line * 5 };

describe('noteHeadAt', () => {
  const slots: PagerSlot[] = [
    { bar: 0, upcoming: false },
    { bar: 1, upcoming: false },
    { bar: 2, upcoming: true },
    { bar: null, upcoming: false },
  ];

  it('현재 페이지 슬롯의 노트 머리 위치(x는 마디 안 비율, y는 보표 위치)', () => {
    expect(noteHeadAt({ ...base, slots, noteIndex: 1 })).toEqual({ x: xInBar(44, 200, 0.5), y: 110 });
    expect(noteHeadAt({ ...base, slots, noteIndex: 2 })).toEqual({ x: xInBar(244, 200, 0.25), y: 140 });
  });

  it('연속 모드의 이펙트 위치는 같은 등간격 음표 위치다', () => {
    expect(noteHeadAt({ ...base, slots, noteIndex: 1, continuousStepsPerBar: 16 })?.x).toBeCloseTo(xInBarContinuous(44, 200, 0.5, 16));
  });

  it('다음 페이지 미리보기(upcoming)·곡 끝 슬롯·없는 노트는 null', () => {
    expect(noteHeadAt({ ...base, slots, noteIndex: 3 })).toBeNull();
    expect(noteHeadAt({ ...base, slots, noteIndex: 99 })).toBeNull();
    expect(noteHeadAt({ ...base, slots: [], noteIndex: 0 })).toBeNull();
  });
});
