import { describe, expect, it } from 'vitest';
import { HIGHWAY_LANES } from '@/features/play/domain/highwayLanes';
import { gameKitScale, laneLinks, LINK_CORNER, LINK_ZONE_H, linkLevels } from './laneLinkGeometry';

const links = laneLinks({ width: 1060, kitScale: 0.7, lanes: HIGHWAY_LANES });
const of = (lane: string) => links.find((l) => l.lane === lane)!;

describe('laneLinkGeometry', () => {
  it('레인마다 경로 하나, 하이햇 페달은 하이햇 패드로 이어진다', () => {
    expect(links.map((l) => l.lane)).toEqual(HIGHWAY_LANES);
    expect(of('HIHAT_PEDAL').pad).toBe('HIHAT');
    expect(of('KICK').pad).toBe('KICK');
  });
  it('시작은 레인 가운데 판정선 아래, 끝은 킷 영역 안이다', () => {
    const kick = of('KICK');
    expect(kick.points[0][1]).toBe(8);
    const end = kick.points[kick.points.length - 1];
    expect(end[1]).toBeGreaterThan(LINK_ZONE_H);
    // 킥 패드 중심 x: 킷 왼쪽 (1060 − 532) / 2 + 390 × 0.7
    expect(end[0]).toBeCloseTo(264 + 273);
  });
  it('꺾이는 높이: 왼쪽으로 가는 선은 오른쪽 레인일수록, 오른쪽으로 가는 선은 왼쪽 레인일수록 낮다', () => {
    expect(linkLevels([120, 30, -10, -40, -90])).toEqual([28, 20, 20, 28, 36]);
    // 한쪽에 아홉 개가 몰려도 연결 구역을 넘지 않는다
    const all = linkLevels([-1, -2, -3, -4, -5, -6, -7, -8, -9]);
    expect(Math.max(...all) + LINK_CORNER).toBeLessThan(LINK_ZONE_H);
  });
  it.each([0.6, 0.7, 1])('킷 배율 %s에서 선끼리 엇갈리지 않는다', (kitScale) => {
    const ls = laneLinks({ width: 1060, kitScale, lanes: HIGHWAY_LANES });
    // 선을 세로·가로 선분으로 풀어 서로 다른 레인의 세로 × 가로가 만나는지 본다(모서리는 꺾이는 점으로 근사)
    const segs = ls.map((l) => {
      const p = l.points;
      if (p.length < 6) return { v: [[p[0][0], p[0][1], p[1][1]]], h: [] as number[][] };
      const level = p[2][1];
      return { v: [[p[0][0], p[0][1], level], [p[5][0], level, p[5][1]]], h: [[level, Math.min(p[0][0], p[5][0]), Math.max(p[0][0], p[5][0])]] };
    });
    for (let a = 0; a < segs.length; a++) {
      for (let b = 0; b < segs.length; b++) {
        if (a === b) continue;
        for (const [y, xa, xb] of segs[a].h) {
          for (const [x, ya, yb] of segs[b].v) {
            const cross = x > xa && x < xb && y > ya && y < yb;
            expect(cross, `${ls[a].lane} 가로 × ${ls[b].lane} 세로`).toBe(false);
          }
        }
      }
    }
  });
  it('꺾이는 곳은 모서리를 잘라 점 여섯 개다', () => {
    expect(of('RIDE').points).toHaveLength(6);
    const [, a, b] = of('RIDE').points;
    expect(Math.abs(b[0] - a[0])).toBe(LINK_CORNER);
    expect(b[1] - a[1]).toBe(LINK_CORNER);
  });
  it('띠는 패드 안쪽까지 가고 폭은 노트 폭과 패드 폭 중 작은 쪽이다', () => {
    const tom = of('SMALL_TOM');
    expect(tom.band.at(-1)![1]).toBeGreaterThan(tom.points.at(-1)![1]);
    // 스몰탐 지름 116 × 0.7 × 0.65 = 52.78 < 노트 폭 66.1
    expect(tom.bandWidth).toBeCloseTo(52.78);
    expect(of('KICK').bandWidth).toBeCloseTo(((1060 - 16) / 9) * 0.57);
  });
  it('폭이 킷보다 좁으면 킷 배율을 폭에 맞춘다', () => {
    const narrow = laneLinks({ width: 380, kitScale: 0.7, lanes: HIGHWAY_LANES });
    const xs = narrow.flatMap((l) => l.points.map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(380);
    expect(laneLinks({ width: 0, kitScale: 0.7, lanes: HIGHWAY_LANES })).toEqual([]);
  });
  it('킷 배율: 높은 화면 0.7, 낮은 화면 0.6', () => {
    expect(gameKitScale(true)).toBe(0.7);
    expect(gameKitScale(false)).toBe(0.6);
  });
});
