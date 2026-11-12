import { describe, expect, it } from 'vitest';
import { fitCamera, makeCamera, mod, project, type Vec3 } from './stickSpace';

describe('makeCamera / project', () => {
  const cam = { ...makeCamera([0, 0, -50], [0, 0, 0]), offsetX: 200, offsetY: 150, scale: 300 };

  it('바라보는 점이 화면 오프셋(원점)에 투영된다', () => {
    const [x, y] = project(cam, [0, 0, 0]);
    expect(x).toBeCloseTo(200, 6);
    expect(y).toBeCloseTo(150, 6);
  });

  it('x가 커지면 화면 x가 커지고 y가 커지면 화면 y가 작아진다', () => {
    const base = project(cam, [0, 0, 0]);
    expect(project(cam, [5, 0, 0])[0]).toBeGreaterThan(base[0]);
    expect(project(cam, [0, 5, 0])[1]).toBeLessThan(base[1]);
  });

  it('조명 방향은 카메라 좌표의 단위 벡터다', () => {
    expect(Math.hypot(...cam.keyLight)).toBeCloseTo(1, 9);
    expect(Math.hypot(...cam.fillLight)).toBeCloseTo(1, 9);
  });
});

describe('fitCamera', () => {
  it('맞춘 뒤 모든 점이 여백 안에 들어온다', () => {
    const cam = makeCamera([0, 44, -42], [0, 0, 5]);
    const pts: Vec3[] = [
      [-30, 0, 0],
      [30, 0, 20],
      [0, 0, 25],
      [10, 30, -10],
      [-15, 5, -30],
    ];
    const sizes: [number, number][] = [
      [520, 520],
      [360, 300],
      [800, 400],
    ];
    for (const [w, h] of sizes) {
      const fit = fitCamera(cam, pts, w, h);
      for (const p of pts) {
        const [x, y] = project(fit, p);
        expect(x).toBeGreaterThanOrEqual(w * 0.06 - 1e-6);
        expect(x).toBeLessThanOrEqual(w * 0.94 + 1e-6);
        expect(y).toBeGreaterThanOrEqual(h * 0.18 - 1e-6);
        expect(y).toBeLessThanOrEqual(h * 0.95 + 1e-6);
      }
    }
  });

  it('원본 카메라를 바꾸지 않는다', () => {
    const cam = makeCamera([0, 44, -42], [0, 0, 5]);
    fitCamera(
      cam,
      [
        [1, 0, 0],
        [0, 0, 3],
      ],
      400,
      400,
    );
    expect(cam.scale).toBe(1);
  });
});

describe('mod', () => {
  it('음수에도 0 이상 n 미만을 돌려준다', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(5, 4)).toBe(1);
  });
});
