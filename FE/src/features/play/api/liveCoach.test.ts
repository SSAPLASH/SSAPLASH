import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SegmentFacts } from '@/coach/live/segment';
import { resetForTest } from '@/api/account/auth';
import { liveCoachClient } from './liveCoach';

const FACTS = {
  contractVersion: 1,
  segment: { index: 0, fromBar: 1, toBar: 4 },
  input: 'stick',
  counts: { perfect: 10, good: 4, miss: 2 },
  timing: { meanDeltaMs: 20, stdDeltaMs: 10, sameSignRatio: 0.8, goodMs: 60 },
  playedPads: ['SNARE'],
  pads: [],
  hands: { weakHand: null, ratio: null },
  ruleCoach: { tags: [], causes: [] },
  previous: { counts: null, lastTip: null },
  stage: 1,
} as SegmentFacts;

function stub(status: number, body?: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('liveCoachClient', () => {
  it('요청은 runId와 사실을 보내고 요청 번호를 돌려준다', async () => {
    const fn = stub(202, { requestId: 'r1', expiresAt: '2026-11-10T00:00:00Z' });
    expect(await liveCoachClient().request('run-1', FACTS)).toEqual({ requestId: 'r1' });
    const init = fn.mock.calls[0][1]!;
    expect(String(fn.mock.calls[0][0])).toBe('/api/v1/live-coach/segments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ runId: 'run-1', facts: FACTS });
  });

  it('꺼져 있으면(204) null, 상한 초과(429)면 limit', async () => {
    stub(204);
    expect(await liveCoachClient().request('run-1', FACTS)).toBeNull();
    stub(429, { code: 'LIVE_COACH_TOO_MANY', title: 't', status: 429 });
    expect(await liveCoachClient().request('run-1', FACTS)).toBe('limit');
  });

  it('조회는 대기 중이면 pending, 완료면 문구, 실패·만료(410)·없음(404)이면 gone', async () => {
    stub(202, { status: 'RUNNING' });
    expect(await liveCoachClient().poll('r1')).toEqual({ kind: 'pending' });
    stub(200, { status: 'DONE', title: '스틱을 낮게', sub: '높이는 주먹 하나만큼', model: 'gemma3:4b', generationMs: 1100 });
    expect(await liveCoachClient().poll('r1')).toEqual({ kind: 'done', title: '스틱을 낮게', sub: '높이는 주먹 하나만큼', model: 'gemma3:4b', generationMs: 1100 });
    stub(410, { code: 'LIVE_COACH_GONE', title: 't', status: 410 });
    expect(await liveCoachClient().poll('r1')).toEqual({ kind: 'gone' });
    stub(404, { code: 'LIVE_COACH_NOT_FOUND', title: 't', status: 404 });
    expect(await liveCoachClient().poll('r1')).toEqual({ kind: 'gone' });
  });
});
