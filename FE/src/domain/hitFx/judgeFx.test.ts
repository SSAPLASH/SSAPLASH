import { describe, expect, it } from 'vitest';
import type { JudgementEvent } from '@/engine/RhythmSession';
import { fxIntensity } from './intensity';
import { JUDGE_COLORS_FALLBACK, judgeFx } from './judgeFx';
import { MAX_SPAWN } from './spawn/util';
import type { FxEvent, FxGeo, FxLocation, FxShape } from './types';

const C = JUDGE_COLORS_FALLBACK;
const ev = (over: Partial<FxEvent> = {}): FxEvent => ({ seq: 7, pad: 'SNARE', velocity: 100, mode: 'game', judgement: null, deltaMs: null, combo: null, ...over });
const geo: FxGeo = { cx: 100, cy: 200, rx: 50, ry: 12, k: 1 };
const at = (shape: FxShape, tint?: string): FxLocation => ({ geo, shape, tint });

describe('fxIntensity 판정 배율', () => {
  const base = fxIntensity(ev({ velocity: 100 }));
  it('판정 null은 1단계와 같다(배율 1)', () => {
    expect(fxIntensity(ev({ velocity: 100, mode: 'free' }))).toEqual(base);
  });
  it('PERFECT: size·count ×1.2, alpha 1 고정', () => {
    const p = fxIntensity(ev({ velocity: 60, judgement: 'PERFECT' }));
    const n = fxIntensity(ev({ velocity: 60 }));
    expect(p.size).toBeCloseTo(n.size * 1.2);
    expect(p.count).toBeCloseTo(n.count * 1.2);
    expect(p.alpha).toBe(1);
  });
  it('GOOD: size ×0.8, count ×0.7, alpha ×0.85', () => {
    const g = fxIntensity(ev({ velocity: 60, judgement: 'GOOD' }));
    const n = fxIntensity(ev({ velocity: 60 }));
    expect(g.size).toBeCloseTo(n.size * 0.8);
    expect(g.count).toBeCloseTo(n.count * 0.7);
    expect(g.alpha).toBeCloseTo(n.alpha * 0.85);
  });
  it('PERFECT > GOOD, 같은 세기에서 항상', () => {
    for (const v of [1, 40, 80, 127]) {
      const p = fxIntensity(ev({ velocity: v, judgement: 'PERFECT' }));
      const g = fxIntensity(ev({ velocity: v, judgement: 'GOOD' }));
      expect(p.size).toBeGreaterThan(g.size);
      expect(p.count).toBeGreaterThan(g.count);
      expect(p.alpha).toBeGreaterThan(g.alpha);
    }
  });
  it('상한: size 1.6, count 1.8', () => {
    const p = fxIntensity(ev({ velocity: 127, judgement: 'PERFECT' }));
    expect(p.size).toBe(1.6);
    expect(p.count).toBeCloseTo(1.8);
    for (const v of [0, 50, 127]) {
      for (const j of ['PERFECT', 'GOOD', null] as const) {
        const r = fxIntensity(ev({ velocity: v, judgement: j }));
        expect(r.size).toBeLessThanOrEqual(1.6);
        expect(r.count).toBeLessThanOrEqual(1.8);
        expect(r.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
  it('악보 모드 패드는 0.7배', () => {
    const g = fxIntensity(ev({ velocity: 80, judgement: 'GOOD', mode: 'game' }));
    const s = fxIntensity(ev({ velocity: 80, judgement: 'GOOD', mode: 'sheet' }));
    expect(s.size).toBeCloseTo(g.size * 0.7);
    expect(s.count).toBeCloseTo(g.count * 0.7);
    expect(s.alpha).toBeCloseTo(g.alpha);
  });
});

describe('judgeFx', () => {
  const shapes: FxShape[] = ['drum', 'cymbal', 'kick', 'lane', 'head'];
  const cases: Partial<FxEvent>[] = [
    {},
    { judgement: 'PERFECT', deltaMs: 3 },
    { judgement: 'GOOD', deltaMs: -40 },
    { judgement: 'GOOD', deltaMs: 40 },
    { judgement: 'MISS' },
    { stray: true },
  ];

  it('결정적: 같은 입력은 같은 파티클', () => {
    for (const shape of shapes) for (const c of cases) expect(judgeFx(ev(c), at(shape), C)).toEqual(judgeFx(ev(c), at(shape), C));
  });

  it('상한 24 이하, 수명 450ms 이하, 값은 유한', () => {
    for (const shape of shapes)
      for (const c of cases)
        for (const reduced of [false, true]) {
          const list = judgeFx(ev(c), at(shape), C, reduced);
          expect(list.length).toBeLessThanOrEqual(MAX_SPAWN);
          for (const p of list) {
            expect(p.lifeMs + p.delayMs).toBeLessThanOrEqual(450);
            for (const v of [p.x, p.y, p.vx, p.vy, p.size0, p.size1]) expect(Number.isFinite(v)).toBe(true);
          }
        }
  });

  it('판정이 없는 이벤트(자유 연주)는 아무것도 내지 않는다', () => {
    for (const shape of shapes) expect(judgeFx(ev(), at(shape), C)).toEqual([]);
  });

  it('패드: PERFECT는 PERFECT색 링, GOOD은 GOOD색 얇은 링, 테마와 무관한 같은 색', () => {
    const p = judgeFx(ev({ judgement: 'PERFECT' }), at('drum'), C);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'ring', color: C.perfect });
    const g = judgeFx(ev({ judgement: 'GOOD' }), at('cymbal'), C);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'ring', color: C.good });
    expect(g[0]!.w0).toBeLessThan(p[0]!.w0);
  });

  it('패드: 헛침은 회색 점 6개, 판정 색을 쓰지 않는다', () => {
    const list = judgeFx(ev({ stray: true }), at('drum'), C);
    expect(list).toHaveLength(6);
    for (const p of list) {
      expect(p.kind).toBe('dot');
      expect(p.color).toBe(C.stray);
    }
  });

  it('패드: 모션 줄이기 헛침은 움직임 없는 옅은 덩어리 하나, 판정 링은 없다', () => {
    expect(judgeFx(ev({ stray: true }), at('drum'), C, true)).toHaveLength(1);
    expect(judgeFx(ev({ judgement: 'PERFECT' }), at('drum'), C, true)).toEqual([]);
  });

  it('하이웨이 PERFECT: 레인 폭 섬광 + 빛 기둥 + 점 8개, 모두 PERFECT색', () => {
    const list = judgeFx(ev({ judgement: 'PERFECT', deltaMs: 2 }), at('lane'), C);
    expect(list.filter((p) => p.kind === 'blob')).toHaveLength(2);
    expect(list.filter((p) => p.kind === 'dot')).toHaveLength(8);
    for (const p of list) expect(p.color).toBe(C.perfect);
    const column = list.find((p) => p.lifeMs === 150);
    expect(column?.ry).toBeGreaterThan(column!.rx); // 세로로 긴 기둥
  });

  it('하이웨이 GOOD: 작은 섬광 + 선 하나. 빠름은 판정선 위, 늦음은 아래', () => {
    const early = judgeFx(ev({ judgement: 'GOOD', deltaMs: -30 }), at('lane'), C);
    const late = judgeFx(ev({ judgement: 'GOOD', deltaMs: 30 }), at('lane'), C);
    for (const list of [early, late]) {
      expect(list.filter((p) => p.kind === 'blob')).toHaveLength(1);
      expect(list.filter((p) => p.kind === 'bolt')).toHaveLength(1);
      for (const p of list) expect(p.color).toBe(C.good);
    }
    const lineY = (l: typeof early) => l.find((p) => p.kind === 'bolt')!.points![1]!;
    expect(lineY(early)).toBeLessThan(geo.cy);
    expect(lineY(late)).toBeGreaterThan(geo.cy);
    // PERFECT보다 작다
    expect(early.length).toBeLessThan(judgeFx(ev({ judgement: 'PERFECT', deltaMs: 0 }), at('lane'), C).length);
  });

  it('하이웨이 MISS: 노트 색 파편 8개(회전), 헛침은 없음', () => {
    const list = judgeFx(ev({ judgement: 'MISS' }), at('lane', '#123456'), C);
    expect(list).toHaveLength(8);
    for (const p of list) {
      expect(p.kind).toBe('shard');
      expect(p.color).toBe('#123456');
      expect(p.spin).not.toBe(0);
      expect(p.lifeMs).toBeLessThanOrEqual(300);
    }
    expect(judgeFx(ev({ stray: true }), at('lane'), C)).toEqual([]);
  });

  it('하이웨이 모션 줄이기: 섬광·깨짐 없음', () => {
    for (const j of ['PERFECT', 'GOOD', 'MISS'] as const) expect(judgeFx(ev({ judgement: j }), at('lane', '#fff'), C, true)).toEqual([]);
  });

  it('악보 머리: PERFECT 고리 + 반짝임 4개, GOOD 작은 고리, MISS 파편 6개(빨강)', () => {
    const p = judgeFx(ev({ judgement: 'PERFECT', mode: 'sheet' }), at('head'), C);
    expect(p.filter((x) => x.kind === 'ring')).toHaveLength(1);
    expect(p.filter((x) => x.kind === 'dot')).toHaveLength(4);
    expect(p[0]!.lifeMs).toBe(250);
    const g = judgeFx(ev({ judgement: 'GOOD', mode: 'sheet' }), at('head'), C);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'ring', color: C.good });
    const m = judgeFx(ev({ judgement: 'MISS', mode: 'sheet' }), at('head'), C);
    expect(m).toHaveLength(6);
    for (const x of m) expect(x.color).toBe(C.miss);
    expect(m[0]!.lifeMs).toBeLessThanOrEqual(200);
  });

  it('악보 머리 이펙트는 작다(링이 머리 크기의 2배 반지름 안쪽에서 시작해 1.5배 이내)', () => {
    const head: FxLocation = { geo: { cx: 0, cy: 0, rx: 12, ry: 9, k: 1 }, shape: 'head' };
    const ring = judgeFx(ev({ judgement: 'PERFECT', mode: 'sheet' }), head, C).find((p) => p.kind === 'ring')!;
    expect(ring.rx * ring.size1).toBeLessThanOrEqual(12 * 1.5);
  });
});

// JudgementEvent 타입 의존 확인(사용처 계약)
describe('계약', () => {
  it('JudgementEvent의 판정은 PERFECT·GOOD·MISS', () => {
    const e: JudgementEvent['judgement'][] = ['PERFECT', 'GOOD', 'MISS'];
    expect(e).toHaveLength(3);
  });
});
