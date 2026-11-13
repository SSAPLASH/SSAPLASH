// 추천 곡·비슷한 곡 상태 (설계 COACH-004-similar-songs D8, 설계 COACH-004-song-recommend-picker 2장·4-1, COACH-004-song-recommend-report D2). 키별로 idle → loading → ready | hidden.
// 키가 없거나 idle일 때만 요청한다 — loading·ready·hidden이면 load는 무시하고, clear 뒤에야 다시 요청한다(StrictMode·재마운트·폴링에도 키당 1회). 시간 초과 5초, 오류·빈 결과는 hidden(D5·D6).
import { create } from 'zustand';
import { fetchRecommendations, postRecommendationClick, type FetchRecommendationsParams } from '@/api/song/recommendations';
import { fetchSimilarSongs, type FetchSimilarParams } from '@/api/song/similarSongs';
import { cardOf, similarCardOf, type RecommendCard } from '@/domain/song/recommendation';

/** 추천 조회 시간 초과(D5). telemetry/sender의 REQUEST_TIMEOUT_MS와 같은 값이지만 store는 domain·api만 import한다(README 의존 방향) */
export const RECOMMENDATION_TIMEOUT_MS = 5000;

export type RecommendationEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; requestId: string; cards: RecommendCard[] }
  | { status: 'hidden' };

const IDLE: RecommendationEntry = { status: 'idle' };
// StrictMode의 즉시 재마운트는 같은 요청을 유지하고, 실제 이탈은 다음 마이크로태스크에서 정리한다.
const pendingClear = new Map<string, object>();
const activeRequests = new Map<string, AbortController>();

interface RecommendationState {
  entries: Record<string, RecommendationEntry>;
  /** `key`는 `${context}:${mode}`(곡 선택) 또는 `REPORT:${playId}`. 키가 없거나 idle일 때만 요청하고 나머지 상태에서는 아무것도 하지 않는다 */
  load: (key: string, params: FetchRecommendationsParams) => Promise<void>;
  /** 비슷한 곡(R2). `key`는 `SIMILAR:${songId}`. `load`와 같은 규칙(키당 1회·5초·빈 결과·오류·404는 hidden) */
  loadSimilar: (key: string, params: { songId: number } & FetchSimilarParams) => Promise<void>;
  /** 클릭 기록을 보내고 결과·오류를 모두 무시한다 */
  click: (card: Pick<RecommendCard, 'song'>, requestId: string) => Promise<void>;
  /**
   * 화면 이탈 시 결과를 버린다. 진행 중인 요청은 StrictMode 재설정과 구분하기 위해 한 마이크로태스크 후 취소한다.
   */
  clear: (key: string) => void;
  resetForTest: () => void;
}

type Store = { setState: (fn: (s: RecommendationState) => Partial<RecommendationState>) => void };

/** 공통 실행기: 키가 없거나 idle일 때만 loading → 5초 시간 초과 → ready | hidden(D2·D8) */
async function run(
  key: string,
  set: Store['setState'],
  get: () => RecommendationState,
  fetcher: (signal: AbortSignal) => Promise<{ requestId: string; cards: RecommendCard[] }>,
): Promise<void> {
  pendingClear.delete(key);
  const cur = get().entries[key];
  if (cur !== undefined && cur.status !== 'idle') return;
  set((s) => ({ entries: { ...s.entries, [key]: { status: 'loading' } } }));
  const ac = new AbortController();
  activeRequests.set(key, ac);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error('추천 시간 초과')); }, RECOMMENDATION_TIMEOUT_MS);
  });
  let next: RecommendationEntry;
  try {
    const { requestId, cards } = await Promise.race([fetcher(ac.signal), timeout]);
    next = cards.length > 0 ? { status: 'ready', requestId, cards } : { status: 'hidden' };
  } catch {
    next = { status: 'hidden' };
  } finally {
    clearTimeout(timer!);
  }
  if (activeRequests.get(key) !== ac) return;
  activeRequests.delete(key);
  set((s) => ({ entries: { ...s.entries, [key]: next } }));
}

export const useRecommendations = create<RecommendationState>()((set, get) => ({
  entries: {},

  load: (key, params) =>
    run(key, set, get, async (signal) => {
      const page = await fetchRecommendations(params, signal);
      return { requestId: page.requestId, cards: page.items.map((item) => params.context === 'DRILL' ? { ...cardOf(item), line: item.reasons[0]?.text ?? '' } : cardOf(item)) };
    }),

  loadSimilar: (key, { songId, ...rest }) =>
    run(key, set, get, async (signal) => {
      const page = await fetchSimilarSongs(songId, rest, signal);
      return { requestId: page.requestId, cards: page.items.map(similarCardOf) };
    }),

  click: async (card, requestId) => {
    try {
      await postRecommendationClick(requestId, card.song.id);
    } catch {
      // 기록 실패는 곡 선택에 영향을 주지 않는다
    }
  },

  clear: (key) => {
    const remove = () => {
      activeRequests.get(key)?.abort();
      activeRequests.delete(key);
      set((s) => {
        if (s.entries[key] === undefined) return s;
        const entries = { ...s.entries };
        delete entries[key];
        return { entries };
      });
    };
    if (get().entries[key]?.status !== 'loading') { remove(); return; }
    const marker = {};
    pendingClear.set(key, marker);
    queueMicrotask(() => {
      if (pendingClear.get(key) !== marker) return;
      pendingClear.delete(key);
      remove();
    });
  },

  resetForTest: () => {
    pendingClear.clear();
    activeRequests.forEach((ac) => ac.abort());
    activeRequests.clear();
    set({ entries: {} });
  },
}));

/** 키의 현재 상태(없으면 idle) */
export function entryOf(entries: Record<string, RecommendationEntry>, key: string): RecommendationEntry {
  return entries[key] ?? IDLE;
}
