// ClockEstimate 검증: 최근 창의 최소 왕복 표본을 목표로 삼고, 적용 오프셋은 한도 안에서 따라간다.
import { describe, expect, it } from 'vitest';
import { ClockEstimate, CLOCK_SLEW_MS_PER_S, CLOCK_WINDOW_MS } from './clockEstimate';

describe('ClockEstimate 목표 오프셋', () => {
  it('표본 전에는 null이고 첫 표본은 즉시 적용한다', () => {
    const e = new ClockEstimate();
    expect(e.applied).toBeNull();
    expect(e.target).toBeNull();
    expect(e.minRtt).toBe(Infinity);
    e.add(0, 5, 100);
    expect(e.applied).toBe(100);
    expect(e.target).toBe(100);
    expect(e.minRtt).toBe(5);
  });

  it('창 안 최소 왕복 + 1ms 이하 표본 가운데 가장 최근 것을 목표로 삼는다', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.add(500, 5.5, 101); // 최소 + 1ms 이하 → 더 최근이라 목표
    e.add(1000, 9, 120); // 왕복이 길어 제외
    expect(e.target).toBe(101);
  });

  it('왕복이 더 짧은 옛 표본도 창(10초)을 넘기면 목표에서 빠진다', () => {
    const e = new ClockEstimate();
    e.add(0, 2, 100);
    for (let t = 1000; t <= CLOCK_WINDOW_MS; t += 1000) e.add(t, 6, 110);
    // 10초째까지는 옛 최소 표본이 창 안에 있다
    expect(e.target).toBe(100);
    expect(e.minRtt).toBe(2);
    e.add(CLOCK_WINDOW_MS + 1000, 6, 110);
    expect(e.target).toBe(110);
    expect(e.minRtt).toBe(6);
  });

  it('주기가 창보다 길어도 가장 최근 표본은 남는다', () => {
    const e = new ClockEstimate();
    e.add(0, 3, 100);
    e.add(30_000, 8, 104);
    expect(e.target).toBe(104);
    expect(e.minRtt).toBe(8);
  });
});

describe('ClockEstimate 적용 오프셋', () => {
  it('목표가 10ms 바뀌어도 초당 1ms 넘게 움직이지 않는다', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.add(3000, 5, 110); // 첫 표본 3초 뒤. 그 사이 3초만큼만 이동
    expect(e.target).toBe(110);
    expect(e.applied).toBeCloseTo(100 + 3 * CLOCK_SLEW_MS_PER_S);
    e.advance(4000);
    expect(e.applied).toBeCloseTo(104);
    e.advance(4500);
    expect(e.applied).toBeCloseTo(104.5);
    // 목표를 넘어가지 않는다
    e.advance(60_000);
    expect(e.applied).toBe(110);
  });

  it('시각이 뒤로 가면 옮기지 않는다', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.add(3000, 5, 110);
    const before = e.applied;
    e.advance(1000);
    expect(e.applied).toBe(before);
  });

  it('첫 표본부터 2초 동안은 목표에 즉시 맞춘다(연속 SYNC 구간)', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.add(500, 3, 130);
    expect(e.applied).toBe(130);
  });

  it('목표와 50ms 이상 벌어지면 즉시 맞춘다', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.add(5000, 4, 160);
    expect(e.applied).toBe(160);
  });

  it('센서 시계가 분당 30ms 흘러도 10분 동안 오차가 10ms 미만이다', () => {
    const e = new ClockEstimate();
    // 참 오프셋: 초당 0.5ms씩 커진다
    const truth = (t: number) => 1000 + 0.0005 * t;
    let worst = 0;
    for (let t = 0; t <= 600_000; t += 1000) {
      // 왕복은 4~8ms로 흔들린다
      e.add(t, 4 + ((t / 1000) % 5), truth(t));
      // 표본 사이의 타격 시점에도 본다
      for (const dt of [0, 250, 500, 750]) {
        e.advance(t + dt);
        worst = Math.max(worst, Math.abs((e.applied as number) - truth(t + dt)));
      }
    }
    expect(worst).toBeLessThan(10);
  });

  it('reset하면 표본·목표·적용을 모두 비운다', () => {
    const e = new ClockEstimate();
    e.add(0, 5, 100);
    e.reset();
    expect(e.applied).toBeNull();
    expect(e.target).toBeNull();
    expect(e.minRtt).toBe(Infinity);
    // 다시 첫 표본부터 즉시 적용
    e.add(50_000, 7, 300);
    expect(e.applied).toBe(300);
  });
});
