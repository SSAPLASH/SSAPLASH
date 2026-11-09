import { describe, expect, it } from 'vitest';
import { CELEBRATE_DELAYS_MS, CELEBRATE_DOTS, CELEBRATE_LIFE_MAX_MS, celebrate } from './celebrate';

const COLORS = ['#ffd23d', '#35a3d4'] as const;

describe('celebrate', () => {
  it('고리 1 + 점 14', () => {
    const list = celebrate(1, 100, 50, COLORS);
    expect(list.filter((p) => p.kind === 'ring')).toHaveLength(1);
    expect(list.filter((p) => p.kind === 'dot')).toHaveLength(CELEBRATE_DOTS);
  });

  it('같은 seq면 같은 파티클(결정적), 다른 seq면 다르다', () => {
    expect(celebrate(5, 10, 20, COLORS)).toEqual(celebrate(5, 10, 20, COLORS));
    expect(celebrate(5, 10, 20, COLORS)).not.toEqual(celebrate(6, 10, 20, COLORS));
  });

  it('세 번 합쳐 45개 이하(상한 200 안), 수명 900ms 이하', () => {
    const all = CELEBRATE_DELAYS_MS.flatMap((_, i) => celebrate(1000 + i, 0, 0, COLORS));
    expect(all.length).toBeLessThanOrEqual(45);
    expect(all.length).toBeLessThanOrEqual(200);
    for (const p of all) expect(p.delayMs + p.lifeMs).toBeLessThanOrEqual(CELEBRATE_LIFE_MAX_MS);
  });

  it('점은 두 색을 교대로 쓰고 중력(아래 가속)이 있다', () => {
    const dots = celebrate(1, 0, 0, COLORS).filter((p) => p.kind === 'dot');
    expect(new Set(dots.map((d) => d.color))).toEqual(new Set(COLORS));
    for (const d of dots) expect(d.ay).toBeGreaterThan(0);
  });

  it('시작 위치는 넘긴 좌표', () => {
    for (const p of celebrate(3, 33, 44, COLORS)) expect([p.x, p.y]).toEqual([33, 44]);
  });
});
