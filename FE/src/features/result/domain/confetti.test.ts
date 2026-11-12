import { describe, expect, it } from 'vitest';
import {
  CONFETTI_CENTER,
  CONFETTI_COLORS,
  CONFETTI_DRAG,
  CONFETTI_END_MS,
  CONFETTI_FADE_MS,
  CONFETTI_GRAVITY,
  CONFETTI_SIDE,
  confettiAt,
  createConfetti,
} from './confetti';

const W = 1440;
const H = 900;

describe('createConfetti', () => {
  it('가운데 폭죽 + 양쪽 모서리 조각 수', () => {
    expect(createConfetti(1, W, H)).toHaveLength(CONFETTI_CENTER + CONFETTI_SIDE * 2);
  });

  it('같은 seq·크기면 같은 조각(결정적), seq가 다르면 다르다', () => {
    expect(createConfetti(3, W, H)).toEqual(createConfetti(3, W, H));
    expect(createConfetti(3, W, H)).not.toEqual(createConfetti(4, W, H));
  });

  it('모든 조각이 처음에는 위로 날고, 색은 정해진 팔레트 안이다', () => {
    for (const p of createConfetti(1, W, H)) {
      expect(p.vy).toBeLessThan(0);
      expect(CONFETTI_COLORS).toContain(p.color);
    }
  });

  it('왼쪽 모서리 조각은 오른쪽으로, 오른쪽 모서리 조각은 왼쪽으로 쏜다', () => {
    const side = createConfetti(1, W, H).slice(CONFETTI_CENTER);
    for (const p of side.slice(0, CONFETTI_SIDE)) expect(p.vx).toBeGreaterThan(0);
    for (const p of side.slice(CONFETTI_SIDE)) expect(p.vx).toBeLessThan(0);
  });

  it('모든 조각이 CONFETTI_END_MS 안에 사라진다', () => {
    for (const p of createConfetti(1, W, H)) expect(p.delayMs + p.lifeMs).toBeLessThanOrEqual(CONFETTI_END_MS);
  });
});

describe('confettiAt', () => {
  const p = createConfetti(1, W, H)[0]!;

  it('나오기 전과 사라진 뒤는 null', () => {
    expect(confettiAt(p, p.delayMs - 1)).toBeNull();
    expect(confettiAt(p, p.delayMs + p.lifeMs)).toBeNull();
  });

  it('나오는 순간은 시작 위치이고 불투명하다', () => {
    const pose = confettiAt(p, p.delayMs)!;
    expect(pose.x).toBeCloseTo(p.x0, 5);
    expect(pose.y).toBeCloseTo(p.y0, 5);
    expect(pose.alpha).toBe(1);
  });

  it('처음에는 올라갔다가 나중에는 떨어진다', () => {
    const up = confettiAt(p, p.delayMs + 200)!;
    const late = confettiAt(p, p.delayMs + p.lifeMs - 1)!;
    expect(up.y).toBeLessThan(p.y0);
    expect(late.y).toBeGreaterThan(up.y);
  });

  it('떨어지는 속도는 끝 속도(중력 ÷ 저항)로 수렴한다', () => {
    const a = confettiAt({ ...p, swayAmp: 0, lifeMs: 10_000 }, p.delayMs + 5000)!;
    const b = confettiAt({ ...p, swayAmp: 0, lifeMs: 10_000 }, p.delayMs + 6000)!;
    expect(b.y - a.y).toBeCloseTo(CONFETTI_GRAVITY / CONFETTI_DRAG, 0);
  });

  it('끝에서 CONFETTI_FADE_MS 동안 흐려지고, 뒤집힘은 -1~1이다', () => {
    const fading = confettiAt(p, p.delayMs + p.lifeMs - CONFETTI_FADE_MS / 2)!;
    expect(fading.alpha).toBeCloseTo(0.5, 5);
    for (let t = 0; t < p.lifeMs; t += 97) {
      const pose = confettiAt(p, p.delayMs + t)!;
      expect(Math.abs(pose.flip)).toBeLessThanOrEqual(1);
    }
  });
});
