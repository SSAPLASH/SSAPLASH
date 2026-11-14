import { describe, expect, it } from 'vitest';
import { HIGHWAY_LANES } from '@/features/play/domain/highwayLanes';
import type { FxEvent } from '@/domain/hitFx/types';
import { HIGHWAY_PEDAL_GAP, highwayLayout, laneCenterX, laneFxGeo, laneLeft, locateHighway, noteY, type HighwayLocateInput } from './highwayGeometry';

const L = highwayLayout(900 + HIGHWAY_PEDAL_GAP, 600, 9);
const ev = (over: Partial<FxEvent>): FxEvent => ({ seq: 1, pad: 'SNARE', velocity: 100, mode: 'game', judgement: 'PERFECT', deltaMs: 0, combo: null, noteIndex: 0, ...over });
const input = (over: Partial<HighwayLocateInput> = {}): HighwayLocateInput => ({
  width: 900 + HIGHWAY_PEDAL_GAP,
  height: 600,
  lanes: HIGHWAY_LANES,
  noteOf: (i) => (i === 0 ? { pad: 'SNARE', timeMs: 1000 } : i === 1 ? { pad: 'HIHAT_PEDAL', timeMs: 1200 } : undefined),
  songTime: 1060,
  scrollMs: 1400,
  tintOf: () => '#abc',
  ...over,
});

describe('highwayGeometry', () => {
  it('판정선은 아래에서 80px, 칸 폭은 (폭 − 페달 칸 간격) ÷ 칸 수로 균등', () => {
    expect(L.judgeY).toBe(520);
    expect(L.laneW).toBe(100);
    expect(L.gap).toBe(16);
    expect(HIGHWAY_PEDAL_GAP).toBe(16);
    expect(L.travel).toBe(490);
  });
  it('noteY: dt 0은 판정선, 양수는 위, 음수는 아래', () => {
    expect(noteY(L, 0, 1400)).toBe(520);
    expect(noteY(L, 1400, 1400)).toBe(30);
    expect(noteY(L, -60, 1400)).toBeGreaterThan(520);
  });
  it('레인 geo: 가운데 x, rx = 레인 폭 0.4, ry = 12', () => {
    expect(laneCenterX(L, 2)).toBe(266);
    expect(laneFxGeo(L, 2, 520)).toEqual({ cx: 266, cy: 520, rx: 40, ry: 12, k: 1 });
  });
  it('페달 칸(첫 칸)만 간격 없이 왼쪽 끝, 둘째 칸부터 간격만큼 밀린다', () => {
    expect(laneLeft(L, 0)).toBe(0);
    expect(laneLeft(L, 1)).toBe(116);
    expect(laneLeft(L, 8)).toBe(816);
    expect(laneLeft(L, 8) + L.laneW).toBe(916);
    expect(laneCenterX(L, 0)).toBe(50);
  });
  it('칸이 하나면 간격이 없다', () => {
    const one = highwayLayout(300, 600, 1);
    expect(one.gap).toBe(0);
    expect(one.laneW).toBe(300);
  });

  it('PERFECT·GOOD는 레인 가운데 × 판정선', () => {
    const loc = locateHighway(ev({ judgement: 'GOOD', deltaMs: 30 }), input())!;
    expect(loc.shape).toBe('lane');
    expect(loc.geo.cx).toBe(laneCenterX(L, HIGHWAY_LANES.indexOf('SNARE')));
    expect(loc.geo.cy).toBe(L.judgeY);
    expect(loc.tint).toBeUndefined();
  });

  it('MISS는 그 노트의 현재 y(판정선 아래)와 노트 색', () => {
    const loc = locateHighway(ev({ judgement: 'MISS', deltaMs: null }), input())!;
    expect(loc.geo.cy).toBeGreaterThan(L.judgeY);
    expect(loc.geo.cy).toBeCloseTo(noteY(L, 1000 - 1060, 1400));
    expect(loc.tint).toBe('#abc');
  });

  it('레인은 노트 패드로 찾는다(하이햇 페달 노트도 페달 레인)', () => {
    const loc = locateHighway(ev({ pad: 'HIHAT', noteIndex: 1 }), input())!;
    expect(loc.geo.cx).toBe(laneCenterX(L, 0));
  });

  it('판정 없음·헛침·모르는 노트·레인에 없는 패드·0 크기는 null', () => {
    expect(locateHighway(ev({ judgement: null }), input())).toBeNull();
    expect(locateHighway(ev({ stray: true, judgement: null }), input())).toBeNull();
    expect(locateHighway(ev({ noteIndex: 99 }), input())).toBeNull();
    expect(locateHighway(ev({ noteIndex: null }), input())).toBeNull();
    expect(locateHighway(ev({}), input({ noteOf: () => ({ pad: 'MID_TOM', timeMs: 0 }), lanes: ['SNARE'] }))).toBeNull();
    expect(locateHighway(ev({}), input({ width: 0 }))).toBeNull();
  });
});
