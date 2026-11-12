import { describe, expect, it } from 'vitest';
import { buildLayoutA } from './stickLayout';
import {
  BEAT,
  hitsBetween,
  poseAt,
  pointOnAxis,
  readyAngle,
  strengthAt,
  strokeTheta,
} from './stickStroke';
import { L_TOTAL } from './stickModel';

const H = readyAngle(0.74);
const EPS = 1e-6;

describe('strokeTheta', () => {
  it('진행 0과 1 가까이에서 든 각이 0이다', () => {
    expect(strokeTheta(0, H)).toBeCloseTo(0, 6);
    expect(strokeTheta(1 - 1e-9, H)).toBeCloseTo(0, 6);
  });

  it('내려침 구간(0.76~1)에서 속도 크기가 단조 증가한다', () => {
    const d = 1e-5;
    let prev = 0;
    for (let tau = 0.77; tau < 0.999; tau += 0.01) {
      const v = Math.abs(strokeTheta(tau + d, H) - strokeTheta(tau - d, H)) / (2 * d);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('튕겨 오름 구간은 처음 속도가 가장 크다', () => {
    const d = 1e-5;
    const speed = (tau: number) => (strokeTheta(tau + d, H) - strokeTheta(tau, H)) / d;
    const v0 = speed(0);
    for (let tau = 0.02; tau < 0.59; tau += 0.02) {
      expect(speed(tau)).toBeLessThan(v0);
    }
  });

  it('구간 경계(0.6, 0.76)에서 값이 이어진다', () => {
    expect(strokeTheta(0.6 - EPS, H)).toBeCloseTo(strokeTheta(0.6 + EPS, H), 4);
    expect(strokeTheta(0.76 - EPS, H)).toBeCloseTo(strokeTheta(0.76 + EPS, H), 4);
  });
});

describe('strengthAt', () => {
  it('세기 순서가 1·0.58·0.74·0.58 반복이다', () => {
    expect([0, 1, 2, 3, 4, 5].map(strengthAt)).toEqual([1, 0.58, 0.74, 0.58, 1, 0.58]);
  });

  it('음수 번호도 같은 순서를 따른다', () => {
    expect(strengthAt(-1)).toBe(0.58);
    expect(strengthAt(-4)).toBe(1);
  });
});

describe('hitsBetween', () => {
  const layout = buildLayoutA();

  it('이어 붙인 두 구간의 합이 전체 구간과 같다(경계 타격은 한 번만)', () => {
    const whole = hitsBetween(layout, -1, 3, 1);
    // 경계를 정확히 타격 시각에 둔다.
    const mid = BEAT * 4;
    const a = hitsBetween(layout, -1, mid, 1);
    const b = hitsBetween(layout, mid, 3, 1);
    expect([...a, ...b]).toEqual(whole);
    expect(a.some((h) => h.time === mid)).toBe(true);
    expect(b.some((h) => h.time === mid)).toBe(false);
  });

  it('시각 순이고 tStart < 시각 ≤ tEnd 이다', () => {
    const hits = hitsBetween(layout, 0.2, 2.5, 1);
    expect(hits.length).toBeGreaterThan(4);
    hits.forEach((h, i) => {
      expect(h.time).toBeGreaterThan(0.2);
      expect(h.time).toBeLessThanOrEqual(2.5);
      if (i > 0) expect(h.time).toBeGreaterThan(hits[i - 1].time);
    });
  });

  it('두 손이 한 박씩 번갈아 친다', () => {
    const hits = hitsBetween(layout, -0.01, 3, 1);
    hits.forEach((h, i) => {
      expect(h.stick).toBe(i % 2);
      expect(h.time).toBeCloseTo(i * BEAT, 9);
    });
  });

  it('음수 시각의 타격도 돌려준다', () => {
    const hits = hitsBetween(layout, -2, -1, 1);
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach((h) => expect(h.time).toBeLessThan(0));
  });

  it('단계 0에서는 모든 타격의 패드가 mainPad다', () => {
    const hits = hitsBetween(layout, 0, 6, 0);
    expect(hits.length).toBeGreaterThan(8);
    hits.forEach((h) => {
      expect(h.padIndex).toBe(layout.mainPad);
      expect(h.name).toBe('SNARE');
    });
  });

  it('단계 1·2에서는 손별 순서(sequence)대로 패드를 친다', () => {
    const hits = hitsBetween(layout, -0.01, 8, 2);
    const right = hits.filter((h) => h.stick === 0).map((h) => h.padIndex);
    const left = hits.filter((h) => h.stick === 1).map((h) => h.padIndex);
    expect(right.slice(0, 4)).toEqual([0, 0, 2, 0]);
    expect(left.slice(0, 4)).toEqual([0, 1, 0, 0]);
  });

  it('세기는 전체 타격 번호로 정해지고 타격점은 패드 목표와 같다', () => {
    const hits = hitsBetween(layout, -0.01, 2, 1);
    hits.forEach((h, i) => {
      expect(h.strength).toBe(strengthAt(i));
      expect(h.hitPoint).toEqual(layout.sticks[h.stick].targets[h.padIndex].hitPoint);
    });
  });
});

describe('poseAt', () => {
  const layout = buildLayoutA();

  it('타격 시각에 든 각이 0이고 팁 높이가 팁 반지름이다', () => {
    const t = 4 * BEAT; // 오른손 k=2의 시작(=k=1의 끝)
    const pose = poseAt(layout, 0, t, 1);
    expect(pose.theta).toBeCloseTo(0, 6);
    const tip = pointOnAxis(pose, 38.6);
    expect(tip[1]).toBeCloseTo(0.9, 6);
  });

  it('세기 1인 타격 직전 주기의 최대 든 각이 다른 주기보다 크다', () => {
    const maxTheta = (stick: number, k: number) => {
      let m = 0;
      for (let i = 0; i < 200; i++) {
        const t = (2 * (k + i / 200) + stick) * BEAT;
        m = Math.max(m, poseAt(layout, stick, t, 1).theta);
      }
      return m;
    };
    // 오른손: 주기 k의 끝에서 치는 타격 번호는 2(k+1). 세기 1은 k가 홀수일 때.
    const strong = maxTheta(0, 1);
    const weak = maxTheta(0, 0);
    expect(strengthAt(2 * (1 + 1))).toBe(1);
    expect(strengthAt(2 * (0 + 1))).toBe(0.74);
    expect(strong).toBeGreaterThan(weak);
  });

  it('주기 번호·타격 번호·패드 번호를 돌려준다', () => {
    const pose = poseAt(layout, 1, (2 * 3 + 1) * BEAT + 0.01, 1);
    expect(pose.period).toBe(3);
    expect(pose.hitIndex).toBe(3 * 2 + 1);
    expect(pose.padIndex).toBe(layout.sticks[1].sequence[3]);
  });

  it('축 위 점: 손잡이 끝(0)과 팁 쪽 끝(전체 길이)이 받침점 반대편이다', () => {
    const pose = poseAt(layout, 0, 0.1, 1);
    const a = pointOnAxis(pose, 0);
    const b = pointOnAxis(pose, L_TOTAL);
    const f = pointOnAxis(pose, 11);
    expect(f[0]).toBeCloseTo(pose.fulcrum[0], 9);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(L_TOTAL, 6);
  });
});
