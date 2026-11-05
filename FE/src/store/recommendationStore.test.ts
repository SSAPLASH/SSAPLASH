import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/recommendations';
import type { RecommendationItem, RecommendationPage } from '@/domain/recommendation';
import { RECOMMENDATION_TIMEOUT_MS, useRecommendations } from './recommendationStore';

vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));

const KEY = 'SONG_PICKER:RHYTHM';
const PARAMS = { context: 'SONG_PICKER', mode: 'RHYTHM', size: 5 } as const;
const item = { song: { id: 12 }, chartId: 34, difficulty: 'EASY', reasons: [] } as unknown as RecommendationItem;
const page = (items: RecommendationItem[]): RecommendationPage => ({ requestId: 'r1', strategy: 's', items });
const status = () => useRecommendations.getState().entries[KEY]?.status;

beforeEach(() => {
  useRecommendations.getState().resetForTest();
  vi.mocked(fetchRecommendations).mockReset();
  vi.mocked(postRecommendationClick).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('load', () => {
  it('성공하면 ready', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([item]));
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(status()).toBe('ready');
  });

  it('빈 items는 hidden', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([]));
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(status()).toBe('hidden');
  });

  it('오류는 hidden이고 던지지 않는다', async () => {
    vi.mocked(fetchRecommendations).mockRejectedValue(new Error('x'));
    await expect(useRecommendations.getState().load(KEY, PARAMS)).resolves.toBeUndefined();
    expect(status()).toBe('hidden');
  });

  it('진행 중이면 같은 키의 두 번째 load는 무시한다', async () => {
    let resolve!: (p: RecommendationPage) => void;
    vi.mocked(fetchRecommendations).mockReturnValue(new Promise((r) => (resolve = r)));
    const first = useRecommendations.getState().load(KEY, PARAMS);
    expect(status()).toBe('loading');
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    resolve(page([item]));
    await first;
    expect(status()).toBe('ready');
  });

  it('끝난 키는 다시 load하면 새로 요청한다(재마운트)', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([item]));
    await useRecommendations.getState().load(KEY, PARAMS);
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(fetchRecommendations).toHaveBeenCalledTimes(2);
  });

  it('5초가 지나면 요청을 끊고 hidden', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchRecommendations).mockImplementation(
      (_p, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('abort')))),
    );
    const p = useRecommendations.getState().load(KEY, PARAMS);
    await vi.advanceTimersByTimeAsync(RECOMMENDATION_TIMEOUT_MS - 1);
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(status()).toBe('hidden');
  });
});

describe('click', () => {
  it('requestId·songId로 기록을 보낸다', async () => {
    vi.mocked(postRecommendationClick).mockResolvedValue(undefined);
    await useRecommendations.getState().click(item, 'r1');
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 12);
  });

  it('실패해도 던지지 않는다', async () => {
    vi.mocked(postRecommendationClick).mockRejectedValue(new Error('404'));
    await expect(useRecommendations.getState().click(item, 'r1')).resolves.toBeUndefined();
  });
});

describe('clear', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useRecommendations.getState().resetForTest();
    vi.mocked(fetchRecommendations).mockReset();
    vi.mocked(postRecommendationClick).mockReset();
  });

  it('끝난 결과(ready·hidden)는 지우고 진행 중(loading)은 그대로 둔다', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue({ requestId: 'r', strategy: 's', items: [] });
    await useRecommendations.getState().load('k1', { context: 'SONG_PICKER', mode: 'RHYTHM' });
    expect(useRecommendations.getState().entries.k1?.status).toBe('hidden');
    useRecommendations.getState().clear('k1');
    expect(useRecommendations.getState().entries.k1).toBeUndefined();

    let resolve: (v: { requestId: string; strategy: string; items: never[] }) => void = () => {};
    vi.mocked(fetchRecommendations).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = useRecommendations.getState().load('k2', { context: 'SONG_PICKER', mode: 'RHYTHM' });
    expect(useRecommendations.getState().entries.k2?.status).toBe('loading');
    useRecommendations.getState().clear('k2');
    expect(useRecommendations.getState().entries.k2?.status).toBe('loading');
    resolve({ requestId: 'r', strategy: 's', items: [] });
    await p;
    expect(useRecommendations.getState().entries.k2?.status).toBe('hidden');
  });

  it('없는 키는 무시한다', () => {
    useRecommendations.getState().clear('none');
    expect(useRecommendations.getState().entries).toEqual({});
  });
});
