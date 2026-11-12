import { describe, expect, it } from 'vitest';
import { buildLayoutA, layoutBounds } from './stickLayout';
import { CONTACT_PHI, FULCRUM_Y, TIP_C, TIP_R } from './stickModel';
import { fitCamera, project } from './stickSpace';
import { pointOnAxis } from './stickStroke';

describe('buildLayoutA', () => {
  const layout = buildLayoutA();

  it('패드 3개(SNARE·HI-HAT·TOM)와 스틱 2자루', () => {
    expect(layout.pads.map((p) => p.name)).toEqual(['SNARE', 'HI-HAT', 'TOM']);
    expect(layout.sticks.map((s) => s.hand)).toEqual(['R', 'L']);
    expect(layout.sticks.map((s) => s.index)).toEqual([0, 1]);
    expect(layout.mainPad).toBe(0);
  });

  it('모든 목표에서 접촉 자세의 팁 중심 높이가 팁 반지름이고 타격점이 패드 원 안이다', () => {
    for (const stick of layout.sticks) {
      stick.targets.forEach((t, padIndex) => {
        const c = Math.cos(CONTACT_PHI);
        const pose = {
          fulcrum: t.fulcrum,
          direction: [t.heading[0] * c, Math.sin(CONTACT_PHI), t.heading[2] * c] as [
            number,
            number,
            number,
          ],
        };
        expect(t.fulcrum[1]).toBeCloseTo(FULCRUM_Y, 9);
        const tip = pointOnAxis(pose, TIP_C);
        expect(tip[1]).toBeCloseTo(TIP_R, 6);
        // 팁 중심의 바닥 투영이 타격점과 같다
        expect(tip[0]).toBeCloseTo(t.hitPoint[0], 6);
        expect(tip[2]).toBeCloseTo(t.hitPoint[2], 6);
        const pad = layout.pads[padIndex];
        const d = Math.hypot(t.hitPoint[0] - pad.center[0], t.hitPoint[2] - pad.center[2]);
        expect(d).toBeLessThan(pad.radius);
      });
    }
  });

  it('패드끼리 겹치지 않는다', () => {
    const { pads } = layout;
    for (let i = 0; i < pads.length; i++) {
      for (let j = i + 1; j < pads.length; j++) {
        const d = Math.hypot(
          pads[i].center[0] - pads[j].center[0],
          pads[i].center[2] - pads[j].center[2],
        );
        expect(d).toBeGreaterThan(pads[i].radius + pads[j].radius);
      }
    }
  });

  it('손 쪽 진행 방향은 바닥 위 단위 벡터다', () => {
    for (const stick of layout.sticks) {
      for (const t of stick.targets) {
        expect(t.heading[1]).toBe(0);
        expect(Math.hypot(t.heading[0], t.heading[2])).toBeCloseTo(1, 9);
      }
    }
  });
});

describe('layoutBounds', () => {
  it('fitCamera로 맞추면 모든 점이 여백 안에 들어온다', () => {
    const layout = buildLayoutA();
    const pts = layoutBounds(layout);
    // 패드 3 × 24 + 스틱 2 × 패드 3 × 자세 2 × 끝 2
    expect(pts).toHaveLength(3 * 24 + 2 * 3 * 2 * 2);
    const fit = fitCamera(layout.camera, pts, 520, 520);
    for (const p of pts) {
      const [x, y] = project(fit, p);
      expect(x).toBeGreaterThanOrEqual(520 * 0.06 - 1e-6);
      expect(x).toBeLessThanOrEqual(520 * 0.94 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(520 * 0.07 - 1e-6);
      expect(y).toBeLessThanOrEqual(520 * 0.95 + 1e-6);
    }
  });
});
