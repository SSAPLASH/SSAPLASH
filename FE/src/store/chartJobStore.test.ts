import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { ACTIVE_JOB_KEY, type UploadDraft } from '@/domain/song/chartJob';
import { useChartJob } from './chartJobStore';

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  let revision = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const response = await handler(url, init);
    // 기존 곡 상태 fixture를 작업 스냅샷으로 바꾼다. 별도 스냅샷 fixture는 그대로 둔다.
    if (isJobGet(url) && response.ok) {
      const body = await response.clone().json() as Record<string, unknown>;
      if ('id' in body && !('jobId' in body)) {
        const status = body.status === 'READY' ? 'DONE' : body.status === 'PROCESSING' ? 'SEPARATING' : body.status;
        return json(200, { jobId: Number(url.split('/').at(-1)), songId: body.id, status, progress: status === 'DONE' ? 100 : 10, revision: ++revision, error: null });
      }
    }
    return response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const problem = (status: number, code: string, detail = '오류') => json(status, { status, detail, code }, 'application/problem+json');
const accepted = () => json(202, { jobId: 11, songId: 22, status: 'QUEUED' });
const songBody = (id: number, status: string, extra: Record<string, unknown> = {}) =>
  json(200, { id, title: '곡', artist: '', source: 'USER', status, ...extra });

const isUpload = (url: string, init?: RequestInit) => url === '/api/v1/songs/audio' && init?.method === 'POST';
const isJobGet = (url: string) => /^\/api\/v1\/jobs\/\d+$/.test(url);
const keyOf = (init: RequestInit | undefined) => new Headers(init?.headers).get('Idempotency-Key');

function draft(over: Partial<UploadDraft> = {}): UploadDraft {
  return { file: new File(['abc'], 'a.mp3', { type: 'audio/mpeg' }), title: '곡', artist: '', idempotencyKey: 'key-1', ...over };
}

function stubStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

let storage: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  resetForTest('tok');
  storage = stubStorage();
});
afterEach(() => {
  useChartJob.getState().clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('chartJobStore', () => {
  it('202 → polling → PROCESSING → READY → done', async () => {
    let status = 'PROCESSING';
    const fetch = mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, status)));

    await useChartJob.getState().upload(draft());
    let s = useChartJob.getState();
    expect(s.phase).toBe('polling');
    expect(s.progress).toMatchObject({ stage: 'QUEUED', stageKnown: true });
    expect(JSON.parse(storage.get(ACTIVE_JOB_KEY)!)).toMatchObject({ jobId: 11, songId: 22, title: '곡', idempotencyKey: 'key-1' });

    await vi.advanceTimersByTimeAsync(3000);
    s = useChartJob.getState();
    expect(s.phase).toBe('polling');
    expect(s.progress).toMatchObject({ stage: 'SEPARATING', stageKnown: true, percent: 10 });

    status = 'READY';
    await vi.advanceTimersByTimeAsync(3000);
    s = useChartJob.getState();
    expect(s.phase).toBe('done');
    expect(s.progress?.stage).toBe('DONE');
    // 완료 후에는 폴링이 멈추고 기록은 남는다
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(true);
  });

  it('업로드 뒤 폴링 중 DONE을 보면 doneSource는 live', async () => {
    mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, 'READY')));
    await useChartJob.getState().upload(draft());
    expect(useChartJob.getState().doneSource).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'done', doneSource: 'live' });
    useChartJob.getState().clear();
    expect(useChartJob.getState().doneSource).toBeNull();
  });

  it('resume 첫 조회에서 DONE·FAILED를 보면 restored, 그 뒤 주기 조회는 live', async () => {
    const job = { jobId: 1, songId: 9, title: '저장된 곡', idempotencyKey: 'k', startedAt: new Date().toISOString() };
    storage.set(ACTIVE_JOB_KEY, JSON.stringify(job));
    mockFetch(() => songBody(9, 'FAILED'));
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', doneSource: 'restored' });
    useChartJob.getState().clear();

    storage.set(ACTIVE_JOB_KEY, JSON.stringify(job));
    let status = 'PROCESSING';
    mockFetch(() => songBody(9, status));
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(useChartJob.getState()).toMatchObject({ phase: 'polling', doneSource: null });
    status = 'READY';
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'done', doneSource: 'live' });

    useChartJob.getState().clear();
    storage.set(ACTIVE_JOB_KEY, JSON.stringify(job));
    mockFetch(() => songBody(9, 'READY'));
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(useChartJob.getState()).toMatchObject({ phase: 'done', doneSource: 'restored' });
  });

  it('곡 상태 FAILED → failed', async () => {
    mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, 'FAILED')));
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    const s = useChartJob.getState();
    expect(s.phase).toBe('failed');
    expect(s.error).toEqual({ code: 'JOB_FAILED', detail: '채보를 만들지 못했습니다.', retryable: false });
  });

  it('작업 단계·revision을 반영하고 같은 revision과 잘못된 ID·알 수 없는 상태를 무시한다', async () => {
    let snapshot = { jobId: 11, songId: 22, status: 'SEPARATING', progress: 0, revision: 1, error: null };
    mockFetch((url, init) => isUpload(url, init) ? accepted() : json(200, snapshot));
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().progress).toMatchObject({ stage: 'SEPARATING', percent: 0, stageKnown: true });
    snapshot = { ...snapshot, status: 'DONE', progress: 100 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().phase).toBe('polling');
    snapshot = { ...snapshot, revision: 2, songId: 99 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().phase).toBe('polling');
    snapshot = { ...snapshot, songId: 22, status: 'UNKNOWN' };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().phase).toBe('polling');
    snapshot = { ...snapshot, status: 'TRANSCRIBING', progress: 55 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().progress).toMatchObject({ stage: 'TRANSCRIBING', percent: 55 });
    snapshot = { ...snapshot, status: 'SEPARATING', progress: 10, revision: 3 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().progress).toMatchObject({ stage: 'SEPARATING', percent: 10 });
    snapshot = { ...snapshot, status: 'DONE', progress: 100, revision: 4 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'done', progress: { percent: 100 } });
  });

  it('작업 실패 error를 보존하고 종료한다', async () => {
    mockFetch((url, init) => isUpload(url, init) ? accepted() : json(200, { jobId: 11, songId: 22, status: 'FAILED', progress: 42, revision: 1, error: { code: 'ERR', message: '변환 실패' } }));
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'JOB_FAILED', detail: '변환 실패' }, progress: { failReason: '변환 실패' } });
  });

  it('작업 ID 없는 복원은 곡 상태로 조회한다', async () => {
    storage.set(ACTIVE_JOB_KEY, JSON.stringify({ jobId: null, songId: 9, title: '곡', idempotencyKey: 'k', startedAt: new Date().toISOString() }));
    const fetch = mockFetch(() => songBody(9, 'PROCESSING'));
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/songs/9');
    expect(useChartJob.getState().progress).toMatchObject({ stageKnown: false, percent: null });
  });

  it('403에서는 폴링을 중단하고 안내한다', async () => {
    const fetch = mockFetch((url, init) => isUpload(url, init) ? accepted() : problem(403, 'FORBIDDEN'));
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'JOB_AUTH' } });
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it('이탈한 이전 작업의 늦은 응답은 현재 작업을 덮지 않는다', async () => {
    let resolve!: (value: Response) => void;
    mockFetch((url, init) => isUpload(url, init) ? accepted() : new Promise<Response>((r) => { resolve = r; }));
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    useChartJob.getState().clear();
    resolve(json(200, { jobId: 11, songId: 22, status: 'DONE', progress: 100, revision: 1, error: null }));
    await vi.advanceTimersByTimeAsync(0);
    expect(useChartJob.getState()).toMatchObject({ phase: 'idle', progress: null });
  });

  it('네트워크 실패 후 retry는 같은 Idempotency-Key로 보낸다', async () => {
    let fail = true;
    const fetch = mockFetch((url, init) => {
      if (isUpload(url, init)) {
        if (fail) throw new TypeError('Failed to fetch');
        return accepted();
      }
      return songBody(22, 'PROCESSING');
    });

    await useChartJob.getState().upload(draft());
    expect(useChartJob.getState().phase).toBe('failed');
    expect(useChartJob.getState().error).toMatchObject({ code: 'NETWORK', retryable: true });

    fail = false;
    await useChartJob.getState().retry();
    expect(useChartJob.getState().phase).toBe('polling');
    const keys = fetch.mock.calls.filter(([u, i]) => isUpload(u, i)).map(([, i]) => keyOf(i));
    expect(keys).toEqual(['key-1', 'key-1']);
  });

  it('409 후 새 키로 한 번만 다시 보낸다', async () => {
    const fetch = mockFetch((url, init) => {
      if (!isUpload(url, init)) return songBody(22, 'PROCESSING');
      return keyOf(init) === 'key-1' ? problem(409, 'AUDIO_CONFLICT') : accepted();
    });
    await useChartJob.getState().upload(draft());
    const keys = fetch.mock.calls.filter(([u, i]) => isUpload(u, i)).map(([, i]) => keyOf(i));
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe('key-1');
    expect(useChartJob.getState().phase).toBe('polling');
  });

  it('409가 또 오면 error로 끝난다', async () => {
    const fetch = mockFetch(() => problem(409, 'AUDIO_CONFLICT'));
    await useChartJob.getState().upload(draft());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'AUDIO_CONFLICT', retryable: false } });
  });

  it('429 BUSY + 내 곡에 PROCESSING 곡이 있으면 active를 복원하고 polling', async () => {
    mockFetch((url, init) => {
      if (isUpload(url, init)) return problem(429, 'AUDIO_BUSY');
      if (url.startsWith('/api/v1/songs?')) {
        return json(200, {
          items: [
            { id: 5, title: '끝난 곡', status: 'READY', createdAt: '2026-10-01T00:00:00Z' },
            { id: 7, title: '진행 곡', status: 'PROCESSING', createdAt: '2026-10-27T00:00:00Z' },
          ],
          hasNext: false,
        });
      }
      return songBody(7, 'PROCESSING');
    });
    await useChartJob.getState().upload(draft());
    const s = useChartJob.getState();
    expect(s.phase).toBe('polling');
    expect(s.active).toMatchObject({ jobId: null, songId: 7, title: '진행 곡', startedAt: '2026-10-27T00:00:00Z' });
    expect(JSON.parse(storage.get(ACTIVE_JOB_KEY)!)).toMatchObject({ songId: 7, jobId: null });
  });

  it('429 BUSY + PROCESSING 곡이 내 곡 두 번째 페이지에 있어도 찾는다 (Jira 363)', async () => {
    mockFetch((url, init) => {
      if (isUpload(url, init)) return problem(429, 'AUDIO_BUSY');
      if (url.startsWith('/api/v1/songs?')) {
        const page = Number(new URL(url, 'http://x').searchParams.get('page'));
        if (page === 0) {
          return json(200, {
            items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `곡${i + 1}`, status: 'READY', createdAt: '2026-10-01T00:00:00Z' })),
            hasNext: true,
          });
        }
        return json(200, { items: [{ id: 301, title: '뒤쪽 진행 곡', status: 'PROCESSING', createdAt: '2026-11-09T00:00:00Z' }], hasNext: false });
      }
      return songBody(301, 'PROCESSING');
    });
    await useChartJob.getState().upload(draft());
    expect(useChartJob.getState().phase).toBe('polling');
    expect(useChartJob.getState().active).toMatchObject({ songId: 301, title: '뒤쪽 진행 곡' });
  });

  it('429 BUSY인데 PROCESSING 곡이 없으면 AUDIO_BUSY 오류', async () => {
    mockFetch((url, init) => (isUpload(url, init) ? problem(429, 'AUDIO_BUSY') : json(200, { items: [], hasNext: false })));
    await useChartJob.getState().upload(draft());
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'AUDIO_BUSY', retryable: false } });
  });

  it('resume이 localStorage 값을 복원하고 즉시 조회한다', async () => {
    const job = { jobId: 1, songId: 9, title: '저장된 곡', idempotencyKey: 'k', startedAt: new Date().toISOString() };
    storage.set(ACTIVE_JOB_KEY, JSON.stringify(job));
    const fetch = mockFetch(() => songBody(9, 'READY'));

    useChartJob.getState().resume();
    expect(useChartJob.getState()).toMatchObject({ phase: 'polling', active: job });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch.mock.calls[0][0]).toBe('/api/v1/jobs/1');
    expect(useChartJob.getState().phase).toBe('done');
  });

  it('resume은 형식이 이상한 값을 무시하고 지운다', () => {
    storage.set(ACTIVE_JOB_KEY, '{"songId":"x"}');
    const fetch = mockFetch(() => songBody(1, 'READY'));
    useChartJob.getState().resume();
    expect(useChartJob.getState().phase).toBe('idle');
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('새 업로드 실패 뒤 이전 작업 저장 기록이 되살아나지 않는다', async () => {
    storage.set(ACTIVE_JOB_KEY, JSON.stringify({ jobId: 1, songId: 9, title: '이전', idempotencyKey: 'k', startedAt: new Date().toISOString() }));
    const fetch = mockFetch(() => { throw new TypeError('network'); });
    await useChartJob.getState().upload(draft());
    expect(useChartJob.getState().phase).toBe('failed');
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(false);
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('진행 중 새 업로드 요청은 기존 작업을 보존한다', async () => {
    const fetch = mockFetch((url, init) => isUpload(url, init) ? accepted() : songBody(22, 'PROCESSING'));
    await useChartJob.getState().upload(draft());
    await useChartJob.getState().upload(draft({ title: '다른 곡' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useChartJob.getState().active?.title).toBe('곡');
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(true);
  });

  it('사전 검사 실패는 fetch를 부르지 않는다', async () => {
    const fetch = mockFetch(() => accepted());
    await useChartJob.getState().upload(draft({ file: new File([], 'a.mp3') }));
    expect(fetch).not.toHaveBeenCalled();
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'PRECHECK_EMPTY', retryable: false } });
  });

  it('조회 404는 AUDIO_NOT_FOUND, 일시 오류는 무시하고 계속한다', async () => {
    let mode: 'net' | '404' = 'net';
    mockFetch((url, init) => {
      if (isUpload(url, init)) return accepted();
      if (mode === 'net') throw new TypeError('Failed to fetch');
      return problem(404, 'NOT_FOUND');
    });
    await useChartJob.getState().upload(draft());
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState().phase).toBe('polling');
    mode = '404';
    await vi.advanceTimersByTimeAsync(3000);
    expect(useChartJob.getState()).toMatchObject({ phase: 'failed', error: { code: 'AUDIO_NOT_FOUND' } });
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(false);
    const before = vi.mocked(fetch).mock.calls.length;
    useChartJob.getState().resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });

  it('폴링 간격: 시작 후 30초까지 3초, 그 뒤 5초', async () => {
    const fetch = mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, 'PROCESSING')));
    await useChartJob.getState().upload(draft());
    const polls = () => fetch.mock.calls.filter(([u]) => isJobGet(u)).length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(polls()).toBe(10);
    await vi.advanceTimersByTimeAsync(5000);
    expect(polls()).toBe(11);
  });

  it('탭이 숨겨지면 폴링을 멈추고 다시 보이면 즉시 1회 조회한다', async () => {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: 'visible',
      addEventListener: (_: string, l: () => void) => void listeners.add(l),
      removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    };
    vi.stubGlobal('document', doc);
    const fetch = mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, 'PROCESSING')));
    const polls = () => fetch.mock.calls.filter(([u]) => isJobGet(u)).length;

    await useChartJob.getState().upload(draft());
    expect(listeners.size).toBe(1);

    doc.visibilityState = 'hidden';
    listeners.forEach((l) => l());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(polls()).toBe(0);

    doc.visibilityState = 'visible';
    listeners.forEach((l) => l());
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(1);

    useChartJob.getState().stopPolling();
    expect(listeners.size).toBe(0);
  });

  it('clear는 폴링을 멈추고 저장 기록과 상태를 지운다', async () => {
    const fetch = mockFetch((url, init) => (isUpload(url, init) ? accepted() : songBody(22, 'PROCESSING')));
    await useChartJob.getState().upload(draft());
    useChartJob.getState().clear();
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(storage.has(ACTIVE_JOB_KEY)).toBe(false);
    expect(useChartJob.getState()).toMatchObject({ phase: 'idle', active: null, progress: null, error: null, draft: null, doneSource: null });
  });
});
