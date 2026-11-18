import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { getJob } from './jobs';

const body = { jobId: 11, songId: 22, status: 'TRANSCRIBING', progress: 53, revision: 2, error: null };
const stub = (value: unknown) => {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
};
beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('getJob', () => {
  it('상태 조회 경로와 Bearer를 사용하고 스냅샷을 보존한다', async () => {
    const fn = stub(body);
    expect(await getJob(11)).toMatchObject(body);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/jobs/11');
  });
  it.each([{ jobId: 'x' }, { songId: 1.2 }, { revision: -1 }, { revision: 'x' }])('잘못된 ID·revision을 거부한다', async (change) => {
    stub({ ...body, ...change });
    await expect(getJob(11)).rejects.toThrow();
  });
});
