// ReferenceCapture 검증: 안정 3초 완료, 흔들림 리셋, 스트림 공백 리셋, restart.
import { describe, expect, it } from 'vitest';
import { ReferenceCapture } from './ReferenceCapture';

const STEP = 16;

/** from부터 durMs 동안 같은 자세를 STEP 간격으로 흘린다. 마지막 시각을 돌려준다 */
function feed(c: ReferenceCapture, from: number, durMs: number, jitter = 0): number {
  let t = from;
  for (; t <= from + durMs; t += STEP) {
    const sign = Math.floor((t - from) / STEP) % 2 ? 1 : -1;
    c.onPose({ pitch: sign * jitter, yaw: 0 }, t);
  }
  return t - STEP;
}

describe('ReferenceCapture', () => {
  it('처음은 idle, progress 0', () => {
    expect(new ReferenceCapture().snapshot()).toEqual({ phase: 'idle', progress: 0, spread: 0 });
  });

  it('안정 자세를 3초 유지하면 done(progress 1)', () => {
    const c = new ReferenceCapture();
    feed(c, 0, 3100);
    expect(c.snapshot().phase).toBe('done');
    expect(c.snapshot().progress).toBe(1);
  });

  it('유지 중에는 holding이고 progress가 오른다', () => {
    const c = new ReferenceCapture();
    feed(c, 0, 1500);
    const s = c.snapshot();
    expect(s.phase).toBe('holding');
    expect(s.progress).toBeGreaterThan(0.3);
    expect(s.progress).toBeLessThan(0.7);
  });

  it('샘플이 5개 모이기 전에는 holding으로 가지 않는다', () => {
    const c = new ReferenceCapture();
    for (let i = 0; i < 4; i++) c.onPose({ pitch: 0, yaw: 0 }, i * STEP);
    expect(c.snapshot().phase).toBe('idle');
  });

  it('중간에 흔들리면 idle로 돌아가고 처음부터 다시 3초가 필요하다', () => {
    const c = new ReferenceCapture();
    let t = feed(c, 0, 2000);
    expect(c.snapshot().phase).toBe('holding');
    // 크게 흔든다(퍼짐 > 3°)
    for (let i = 0; i < 8; i++) {
      t += STEP;
      c.onPose({ pitch: i % 2 ? 20 : -20, yaw: 0 }, t);
    }
    expect(c.snapshot().phase).toBe('idle');
    expect(c.snapshot().progress).toBe(0);
    // 흔들림이 창에서 빠질 때까지 지난 뒤 2초만 더 유지하면 아직 완료 아님
    t = feed(c, t + STEP, 2000);
    expect(c.snapshot().phase).not.toBe('done');
    t = feed(c, t + STEP, 1500);
    expect(c.snapshot().phase).toBe('done');
  });

  it('스트림 공백이 windowMs를 넘으면 리셋한다', () => {
    const c = new ReferenceCapture();
    const t = feed(c, 0, 2500);
    expect(c.snapshot().progress).toBeGreaterThan(0.7);
    // 1초 공백 뒤 재개: 공백이 진행에 더해지지 않는다
    feed(c, t + 1000, 200);
    expect(c.snapshot().phase).not.toBe('done');
    expect(c.snapshot().progress).toBeLessThan(0.2);
  });

  it('done 뒤에는 입력이 와도 바뀌지 않는다', () => {
    const c = new ReferenceCapture();
    const t = feed(c, 0, 3100);
    c.onPose({ pitch: 90, yaw: 90 }, t + STEP);
    expect(c.snapshot().phase).toBe('done');
    expect(c.snapshot().progress).toBe(1);
  });

  it('restart는 idle로 되돌리고 다시 3초를 셀 수 있다', () => {
    const c = new ReferenceCapture();
    const t = feed(c, 0, 3100);
    c.restart();
    expect(c.snapshot()).toEqual({ phase: 'idle', progress: 0, spread: 0 });
    feed(c, t + STEP, 3100);
    expect(c.snapshot().phase).toBe('done');
  });

  it('구독자는 상태 변화를 받고 해제할 수 있다', () => {
    const c = new ReferenceCapture();
    const seen: string[] = [];
    const off = c.subscribe((s) => seen.push(s.phase));
    feed(c, 0, 200);
    off();
    const n = seen.length;
    feed(c, 400, 200);
    expect(seen.length).toBe(n);
    expect(seen[0]).toBe('idle');
  });

  it('holdMs·stabilityDeg를 바꿀 수 있다', () => {
    const c = new ReferenceCapture({ holdMs: 500 });
    feed(c, 0, 600);
    expect(c.snapshot().phase).toBe('done');
  });
});
