// PENDING 재조회 타이머 (COACH-003 4-1): 간격·횟수·즉시 중단·실패 소모·정리
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisStatus, Report } from '@/domain/play/report';
import { createAnalysisPoller } from './analysisPoller';

const rep = (analysisStatus: AnalysisStatus) => ({ analysisStatus }) as Report;

function setup(results: Array<AnalysisStatus | 'ERR'>) {
  const calls = { n: 0 };
  const refresh = vi.fn(async () => {
    const r = results[Math.min(calls.n++, results.length - 1)];
    if (r === 'ERR') throw new Error('network');
    return rep(r);
  });
  const onReport = vi.fn();
  const onExhausted = vi.fn();
  const poller = createAnalysisPoller({ intervalMs: 2000, max: 5, refresh, onReport, onExhausted });
  return { refresh, onReport, onExhausted, poller };
}

describe('createAnalysisPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('2초 간격으로 5회 호출한 뒤 exhausted', async () => {
    const t = setup(['PENDING']);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.refresh).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(t.refresh).toHaveBeenCalledTimes(5);
    expect(t.onExhausted).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(t.refresh).toHaveBeenCalledTimes(5);
  });

  it('DONE이 오면 즉시 멈춘다', async () => {
    const t = setup(['PENDING', 'DONE']);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(t.refresh).toHaveBeenCalledTimes(2);
    expect(t.onReport).toHaveBeenCalledTimes(2);
    expect(t.onExhausted).not.toHaveBeenCalled();
  });

  it('실패는 횟수만 소모하고 넘어간다', async () => {
    const t = setup(['ERR']);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(t.refresh).toHaveBeenCalledTimes(5);
    expect(t.onReport).not.toHaveBeenCalled();
    expect(t.onExhausted).toHaveBeenCalledTimes(1);
  });

  it('stop하면 타이머가 해제된다', async () => {
    const t = setup(['PENDING']);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(2000);
    t.poller.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it('exhausted 뒤 start하면 5회를 다시 시작한다', async () => {
    const t = setup(['PENDING']);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10000);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(t.refresh).toHaveBeenCalledTimes(10);
    expect(t.onExhausted).toHaveBeenCalledTimes(2);
  });
});
