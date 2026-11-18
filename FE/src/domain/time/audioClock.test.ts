// 오디오 시계가 흐르는지 판단 (설계 MODE-001 오디오 시계 시작 대기 3장)
import { describe, expect, it } from 'vitest';
import { CLOCK_STALL_MS, clockFlowing, clockStalled, type ClockSample } from './audioClock';

/**
 * 20ms마다 읽은 표본을 만든다. stallMs 동안은 오디오 시계가 멈춰 있고 그 뒤로는 화면 시계와 같은 속도로 흐른다.
 * out: 'fresh'면 출력 시각이 지금과 같고, 'stale'이면 staleMs만큼 오래된 값, 'none'이면 없음(0·미지원)
 */
function run(totalMs: number, opts: { stallMs?: number; rate?: number; out?: 'fresh' | 'stale' | 'none'; staleMs?: number; startPerf?: number; startCtx?: number } = {}): ClockSample[] {
  const { stallMs = 0, rate = 1, out = 'fresh', staleMs = 400, startPerf = 1000, startCtx = 0 } = opts;
  const samples: ClockSample[] = [];
  for (let t = 0; t <= totalMs; t += 20) {
    const flowed = Math.max(0, t - stallMs) * rate;
    const perfMs = startPerf + t;
    samples.push({ perfMs, ctxSec: startCtx + flowed / 1000, outPerfMs: out === 'none' ? null : out === 'fresh' ? perfMs : perfMs - staleMs });
  }
  return samples;
}

describe('clockFlowing', () => {
  it('표본이 150ms 구간을 채우기 전에는 거짓', () => {
    expect(clockFlowing([])).toBe(false);
    expect(clockFlowing(run(0))).toBe(false);
    expect(clockFlowing(run(140))).toBe(false);
  });

  it('오디오 시계가 화면 시계와 같이 흐르고 출력 시각이 최신이면 150ms 만에 참', () => {
    expect(clockFlowing(run(160))).toBe(true);
  });

  it('오디오 시계가 멈춰 있으면 거짓(첫 접속 직후: currentTime 0)', () => {
    expect(clockFlowing(run(600, { stallMs: 600 }))).toBe(false);
    expect(clockFlowing(run(1200, { stallMs: 1200, out: 'none' }))).toBe(false);
  });

  it('멈췄다가 흐르기 시작하면, 흐른 지 150ms가 지나야 참', () => {
    // 700ms 멈춤 뒤 흐름. 800ms 시점은 최근 150ms 중 100ms만 흘렀다
    expect(clockFlowing(run(800, { stallMs: 700 }))).toBe(false);
    expect(clockFlowing(run(860, { stallMs: 700 }))).toBe(true);
  });

  it('흐르는 속도가 90%에 못 미치면 거짓, 90% 이상이면 참', () => {
    expect(clockFlowing(run(400, { rate: 0.8 }))).toBe(false);
    expect(clockFlowing(run(400, { rate: 0.95 }))).toBe(true);
  });

  it('출력 시각이 오래됐으면(탭 복귀 직후: 322·772ms 지난 값) 시계가 흘러도 아직 거짓', () => {
    expect(clockFlowing(run(300, { out: 'stale', staleMs: 322 }))).toBe(false);
  });

  it('출력 시각이 오래됐거나 없어도, 오디오 시계가 500ms 이상 계속 흘렀으면 참', () => {
    expect(clockFlowing(run(480, { out: 'stale' }))).toBe(false);
    expect(clockFlowing(run(520, { out: 'stale' }))).toBe(true);
    expect(clockFlowing(run(520, { out: 'none' }))).toBe(true);
  });

  it('출력 시각이 없고 최근 500ms 안에 멈춤이 있었으면 거짓', () => {
    // 300ms 멈춤 뒤 흐름. 700ms 시점의 최근 500ms에는 멈춤 100ms가 들어 있다(흐름 80%)
    expect(clockFlowing(run(700, { stallMs: 300, out: 'none' }))).toBe(false);
    expect(clockFlowing(run(860, { stallMs: 300, out: 'none' }))).toBe(true);
  });

  it('출력 시각 차이는 100ms까지 최신으로 본다', () => {
    expect(clockFlowing(run(200, { out: 'stale', staleMs: 100 }))).toBe(true);
    expect(clockFlowing(run(200, { out: 'stale', staleMs: 101 }))).toBe(false);
  });

  it('오래 떠 있던 컨텍스트(currentTime이 큰 값)에서도 같다', () => {
    expect(clockFlowing(run(160, { startPerf: 380_000, startCtx: 349.7707 }))).toBe(true);
    expect(clockFlowing(run(500, { startPerf: 380_000, startCtx: 349.7707, stallMs: 500 }))).toBe(false);
  });

  it('표본 간격이 고르지 않아도(타이머가 늦게 돌아도) 판단한다', () => {
    const samples: ClockSample[] = [
      { perfMs: 0, ctxSec: 0, outPerfMs: 0 },
      { perfMs: 1000, ctxSec: 1, outPerfMs: 1000 },
    ];
    expect(clockFlowing(samples)).toBe(true);
    expect(clockFlowing([samples[0], { perfMs: 1000, ctxSec: 0.5, outPerfMs: 1000 }])).toBe(false);
  });
});

describe('clockStalled', () => {
  it('화면 시계 − 오디오 시계 차이가 직전보다 50ms 넘게 커지면 참', () => {
    expect(clockStalled(33217, 34221)).toBe(true);
    expect(clockStalled(1000, 1000 + CLOCK_STALL_MS + 1)).toBe(true);
  });
  it('50ms 이하의 흔들림이나 줄어든 경우는 거짓', () => {
    expect(clockStalled(1000, 1000 + CLOCK_STALL_MS)).toBe(false);
    expect(clockStalled(1000, 1004)).toBe(false);
    expect(clockStalled(1000, 900)).toBe(false);
  });
  it('직전 값이 없으면 거짓', () => {
    expect(clockStalled(null, 34221)).toBe(false);
  });
});
