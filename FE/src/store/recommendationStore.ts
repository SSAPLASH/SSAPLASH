// 추천 곡 상태 (설계 COACH-004-song-recommend-picker 2장·4-1, COACH-004-song-recommend-report D2). 키별로 idle → loading → ready | hidden.
// 키가 없거나 idle일 때만 요청한다 — loading·ready·hidden이면 load는 무시하고, clear 뒤에야 다시 요청한다(StrictMode·재마운트·폴링에도 키당 1회). 시간 초과 5초, 오류·빈 결과는 hidden(D5·D6).
import { create } from 'zustand';
import { fetchRecommendations, postRecommendationClick, type FetchRecommendationsParams } from '@/api/recommendations';
import { cardOf, type RecommendCard } from '@/domain/recommendation';

/** 추천 조회 시간 초과(D5). telemetry/sender의 REQUEST_TIMEOUT_MS와 같은 값이지만 store는 domain·api만 import한다(README 의존 방향) */
export const RECOMMENDATION_TIMEOUT_MS = 5000;

export type RecommendationEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; requestId: string; cards: RecommendCard[] }
  | { status: 'hidden' };

const IDLE: RecommendationEntry = { status: 'idle' };

interface RecommendationState {
  entries: Record<string, RecommendationEntry>;
  /** `key`는 `${context}:${mode}`(곡 선택) 또는 `REPORT:${playId}`. 키가 없거나 idle일 때만 요청하고 나머지 상태에서는 아무것도 하지 않는다 */
  load: (key: string, params: FetchRecommendationsParams) => Promise<void>;
  /** 클릭 기록을 보내고 결과·오류를 모두 무시한다 */
  click: (card: Pick<RecommendCard, 'song'>, requestId: string) => Promise<void>;
  /**
   * 화면을 닫을 때 끝난 결과(ready·hidden)를 버린다. 다음 마운트가 이전 추천을 잠깐 보이지 않게 하고(옛 requestId로 기록되는 것도 막는다),
   * 진행 중(loading)은 그대로 둬 StrictMode의 효과 정리에서도 요청이 한 번만 나간다(D3)
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
  const cur = get().entries[key];
  if (cur !== undefined && cur.status !== 'idle') return;
  set((s) => ({ entries: { ...s.entries, [key]: { status: 'loading' } } }));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RECOMMENDATION_TIMEOUT_MS);
  let next: RecommendationEntry;
  try {
    const { requestId, cards } = await fetcher(ac.signal);
    next = cards.length > 0 ? { status: 'ready', requestId, cards } : { status: 'hidden' };
  } catch {
    next = { status: 'hidden' };
  } finally {
    clearTimeout(timer);
  }
  set((s) => ({ entries: { ...s.entries, [key]: next } }));
}

export const useRecommendations = create<RecommendationState>()((set, get) => ({
  entries: {},

  load: (key, params) =>
    run(key, set, get, async (signal) => {
      const page = await fetchRecommendations(params, signal);
      return { requestId: page.requestId, cards: page.items.map(cardOf) };
    }),

  click: async (card, requestId) => {
    try {
      await postRecommendationClick(requestId, card.song.id);
    } catch {
      // 기록 실패는 곡 선택에 영향을 주지 않는다
    }
  },

  clear: (key) =>
    set((s) => {
      if (s.entries[key] === undefined || s.entries[key].status === 'loading') return s;
      const entries = { ...s.entries };
      delete entries[key];
      return { entries };
    }),

  resetForTest: () => set({ entries: {} }),
}));

/** 키의 현재 상태(없으면 idle) */
export function entryOf(entries: Record<string, RecommendationEntry>, key: string): RecommendationEntry {
  return entries[key] ?? IDLE;
}
