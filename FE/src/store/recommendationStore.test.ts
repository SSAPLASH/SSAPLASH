import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/song/recommendations';
import type { RecommendationItem, RecommendationPage } from '@/domain/song/recommendation';
import { fetchSimilarSongs } from '@/api/song/similarSongs';
import type { SimilarPage } from '@/domain/song/recommendation';
import { RECOMMENDATION_TIMEOUT_MS, useRecommendations } from './recommendationStore';

vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));

const KEY = 'SONG_PICKER:RHYTHM';
const PARAMS = { context: 'SONG_PICKER', mode: 'RHYTHM', size: 5 } as const;
const item = { song: { id: 12 }, chartId: 34, difficulty: 'EASY', reasons: [] } as unknown as RecommendationItem;
const page = (items: RecommendationItem[]): RecommendationPage => ({ requestId: 'r1', strategy: 's', items });
const status = () => useRecommendations.getState().entries[KEY]?.status;

beforeEach(() => {
  useRecommendations.getState().resetForTest();
  vi.mocked(fetchRecommendations).mockReset();
  vi.mocked(postRecommendationClick).mockReset();
  vi.mocked(fetchSimilarSongs).mockReset();
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

  it('ready·hidden인 키의 load는 무시하고 clear 뒤에는 다시 요청한다', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([item]));
    await useRecommendations.getState().load(KEY, PARAMS);
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    useRecommendations.getState().clear(KEY);
    await useRecommendations.getState().load(KEY, PARAMS);
    expect(fetchRecommendations).toHaveBeenCalledTimes(2);

    vi.mocked(fetchRecommendations).mockResolvedValue(page([]));
    await useRecommendations.getState().load('H', PARAMS);
    await useRecommendations.getState().load('H', PARAMS);
    expect(fetchRecommendations).toHaveBeenCalledTimes(3);
    expect(useRecommendations.getState().entries.H?.status).toBe('hidden');
  });

  it('DRILL은 기존 코드와 겹쳐도 서버 문구를 그대로 쓴다', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([{ ...item, reasons: [{ code: 'STARTER', text: '서버 문구' }] }]));
    await useRecommendations.getState().load('DRILL:p1', { context: 'DRILL', mode: 'RHYTHM', playId: 'p1', size: 3 });
    expect(useRecommendations.getState().entries['DRILL:p1']).toMatchObject({ status: 'ready', cards: [{ line: '서버 문구' }] });
  });

  it('시간 초과 후 늦은 응답이 와도 hidden을 유지한다', async () => {
    vi.useFakeTimers();
    let resolve!: (p: RecommendationPage) => void;
    vi.mocked(fetchRecommendations).mockReturnValue(new Promise((r) => { resolve = r; }));
    const p = useRecommendations.getState().load(KEY, PARAMS);
    await vi.advanceTimersByTimeAsync(RECOMMENDATION_TIMEOUT_MS);
    await p;
    expect(status()).toBe('hidden');
    resolve(page([item]));
    await Promise.resolve();
    expect(status()).toBe('hidden');
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

  it('끝난 결과를 지우고 진행 중이면 이탈 확정 후 지운다', async () => {
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
    expect(useRecommendations.getState().entries.k2).toBeUndefined();
  });

  it('이탈한 요청의 늦은 응답은 새 진입 결과를 덮지 않는다', async () => {
    let resolveOld: (v: { requestId: string; strategy: string; items: never[] }) => void = () => {};
    vi.mocked(fetchRecommendations).mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ requestId: 'new', strategy: 's', items: [item] });
    const old = useRecommendations.getState().load('again', PARAMS);
    useRecommendations.getState().clear('again');
    await Promise.resolve();
    await useRecommendations.getState().load('again', PARAMS);
    resolveOld({ requestId: 'old', strategy: 's', items: [] });
    await old;
    expect(fetchRecommendations).toHaveBeenCalledTimes(2);
    expect(useRecommendations.getState().entries.again).toMatchObject({ status: 'ready', requestId: 'new' });
  });

  it('없는 키는 무시한다', () => {
    useRecommendations.getState().clear('none');
    expect(useRecommendations.getState().entries).toEqual({});
  });
});

describe('ready 항목', () => {
  it('R1은 requestId와 카드(line = 첫 이유 문구)를 든다', async () => {
    const r = { ...item, reasons: [{ code: 'STARTER', text: 'x' }] } as unknown as RecommendationItem;
    vi.mocked(fetchRecommendations).mockResolvedValue(page([r]));
    await useRecommendations.getState().load(KEY, PARAMS);
    const e = useRecommendations.getState().entries[KEY];
    expect(e).toMatchObject({ status: 'ready', requestId: 'r1' });
    expect(e?.status === 'ready' && e.cards[0]).toMatchObject({ chartId: 34, line: '처음 시작하기 좋은 쉬운 곡이에요' });
  });
});

describe('loadSimilar', () => {
  const SK = 'SIMILAR:12';
  const spage = (n: number): SimilarPage => ({
    requestId: 's1', strategy: 'SIMILAR_V1',
    items: Array.from({ length: n }, () => ({ song: { id: 5 }, chartId: 8, difficulty: 'HARD', similarity: 0.9, matchedOn: ['TEMPO'] })) as unknown as SimilarPage['items'],
  });
  const st = () => useRecommendations.getState().entries[SK];

  it('songId를 경로 인자로, 나머지를 옵션으로 넘기고 카드(line = matchedOn 문구)를 든다', async () => {
    vi.mocked(fetchSimilarSongs).mockResolvedValue(spage(1));
    await useRecommendations.getState().loadSimilar(SK, { songId: 12, difficulty: 'EASY', size: 5 });
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0].slice(0, 2)).toEqual([12, { difficulty: 'EASY', size: 5 }]);
    expect(st()).toMatchObject({ status: 'ready', requestId: 's1' });
    const e = st();
    expect(e?.status === 'ready' && e.cards[0].line).toBe('템포가 비슷해요');
  });

  it('키당 1회 — ready·loading이면 무시하고 clear 뒤에는 다시 요청한다', async () => {
    vi.mocked(fetchSimilarSongs).mockResolvedValue(spage(1));
    await useRecommendations.getState().loadSimilar(SK, { songId: 12 });
    await useRecommendations.getState().loadSimilar(SK, { songId: 12 });
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    useRecommendations.getState().clear(SK);
    await useRecommendations.getState().loadSimilar(SK, { songId: 12 });
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(2);
  });

  it('빈 items·404·오류는 hidden', async () => {
    vi.mocked(fetchSimilarSongs).mockResolvedValue(spage(0));
    await useRecommendations.getState().loadSimilar(SK, { songId: 12 });
    expect(st()?.status).toBe('hidden');
    vi.mocked(fetchSimilarSongs).mockRejectedValue(new Error('404'));
    await useRecommendations.getState().loadSimilar('SIMILAR:13', { songId: 13 });
    expect(useRecommendations.getState().entries['SIMILAR:13']?.status).toBe('hidden');
  });

  it('5초가 지나면 hidden', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSimilarSongs).mockImplementation(
      (_id, _o, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('abort')))),
    );
    const p = useRecommendations.getState().loadSimilar(SK, { songId: 12 });
    await vi.advanceTimersByTimeAsync(RECOMMENDATION_TIMEOUT_MS);
    await p;
    expect(st()?.status).toBe('hidden');
  });

  it('R1과 같은 키 규칙을 공유한다(서로 다른 키는 독립)', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue(page([item]));
    vi.mocked(fetchSimilarSongs).mockResolvedValue(spage(1));
    await useRecommendations.getState().load('REPORT:p1', { context: 'REPORT', mode: 'RHYTHM', playId: 'p1' });
    await useRecommendations.getState().loadSimilar('SIMILAR:12', { songId: 12 });
    expect(useRecommendations.getState().entries['REPORT:p1']?.status).toBe('ready');
    expect(useRecommendations.getState().entries['SIMILAR:12']?.status).toBe('ready');
  });
});
