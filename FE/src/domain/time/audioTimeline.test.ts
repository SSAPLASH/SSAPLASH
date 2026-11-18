import { describe, expect, it } from 'vitest';
import {
  HEARD_FOLLOW,
  HEARD_JUMP_MS,
  contextToHeardPerfMs,
  heardOffsetMs,
  sessionStartPerf,
  smoothOffsetMs,
  songToContextSec,
  stallAwareHeard,
} from './audioTimeline';

describe('audioTimeline', () => {
  it('들리는 시각 차이는 perf − heard × 1000', () => {
    expect(heardOffsetMs({ perfMs: 5000, ctxSec: 2.8, heardCtxSec: 2 })).toBe(3000);
  });

  it('곡 시각 ↔ 오디오 시계 시각', () => {
    expect(songToContextSec(1500, 10)).toBeCloseTo(11.5, 9);
    expect(songToContextSec(-500, 10)).toBeCloseTo(9.5, 9);
    expect(contextToHeardPerfMs(11.5, 3000)).toBe(14500);
  });

  it('차이 추정값: 처음과 큰 변화는 바로, 작은 변화는 조금씩', () => {
    expect(smoothOffsetMs(null, 100)).toBe(100);
    expect(smoothOffsetMs(100, 100 + HEARD_JUMP_MS + 1)).toBe(100 + HEARD_JUMP_MS + 1);
    expect(smoothOffsetMs(100, 110)).toBeCloseTo(100 + 10 * HEARD_FOLLOW, 9);
  });

  it('출력 지연이 커져도 클릭 예약 시각은 곡 시각과 ctxZero만으로 정해진다', () => {
    // 같은 곡 시각은 지연과 상관없이 같은 오디오 시계 시각
    const z = 20;
    expect(songToContextSec(3000, z)).toBeCloseTo(23, 9);
  });

  it('세션 기준 시각: 들리는 곡 시각을 따른다', () => {
    const r = sessionStartPerf(3000, 10, 14000, null);
    expect(r.startPerf).toBe(13000);
    expect(r.songMs).toBe(1000);
  });

  it('오디오 시계가 멈추면 곡 시각이 줄지 않고 멈춘다', () => {
    // 멈춤 동안 들리는 시각이 안 흘러 차이가 커짐(3000 → 3500)
    const before = sessionStartPerf(3000, 10, 14000, null);
    const during = sessionStartPerf(3500, 10, 14300, before.songMs);
    expect(during.songMs).toBe(before.songMs);
    expect(during.held).toBe(true);
    expect(before.held).toBe(false);
    expect(during.startPerf).toBe(14300 - before.songMs);
  });

  it('오디오가 앞서면 곡 시각이 따라간다', () => {
    const r = sessionStartPerf(2900, 10, 14000, 1000);
    expect(r.songMs).toBe(1100);
  });

  it('멈춤 판단: currentTime이 안 흐르면 들리는 시각을 currentTime − 직전 간격으로 묶는다', () => {
    const a = stallAwareHeard(null, { perfMs: 0, ctxSec: 10, heardCtxSec: 9.7 });
    // 정상 100ms
    const b = stallAwareHeard(a.state, { perfMs: 100, ctxSec: 10.1, heardCtxSec: 9.8 });
    expect(b.stalled).toBe(false);
    expect(b.heardCtxSec).toBeCloseTo(9.8, 9);
    // 멈춤: currentTime 그대로, 출력 시각은 화면 시계로 이어 셈해 계속 흐름
    const c = stallAwareHeard(b.state, { perfMs: 300, ctxSec: 10.1, heardCtxSec: 10.0 });
    expect(c.stalled).toBe(true);
    expect(c.heardCtxSec).toBeCloseTo(9.8, 9);
    // 짧은 간격은 직전 판단을 이어 씀
    const d = stallAwareHeard(c.state, { perfMs: 320, ctxSec: 10.1, heardCtxSec: 10.02 });
    expect(d.heardCtxSec).toBeCloseTo(9.8, 9);
    // 다시 흐르면 간격을 새로 잡음
    const e = stallAwareHeard(d.state, { perfMs: 500, ctxSec: 10.3, heardCtxSec: 10.0 });
    expect(e.stalled).toBe(false);
    expect(e.heardCtxSec).toBeCloseTo(10.0, 9);
  });

  it('짧은 간격의 계단(currentTime이 처리 단위로 오름)은 멈춤으로 보지 않는다', () => {
    const a = stallAwareHeard(null, { perfMs: 0, ctxSec: 10, heardCtxSec: 9.7 });
    const b = stallAwareHeard(a.state, { perfMs: 8, ctxSec: 10, heardCtxSec: 9.708 });
    expect(b.stalled).toBe(false);
    expect(b.heardCtxSec).toBeCloseTo(9.708, 9);
  });
});
