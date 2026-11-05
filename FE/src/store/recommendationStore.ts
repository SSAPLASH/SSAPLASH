// 추천 곡 상태 (설계 COACH-004-song-recommend-picker 2장·4-1). 키(`context:mode`)별로 idle → loading → ready | hidden.
// 같은 키가 진행 중이면 두 번째 load는 버린다(StrictMode 이중 효과, D3). 시간 초과 5초, 오류·빈 결과는 hidden(D5·D6).
import { create } from 'zustand';
import { fetchRecommendations, postRecommendationClick, type FetchRecommendationsParams } from '@/api/recommendations';
import type { RecommendationItem, RecommendationPage } from '@/domain/recommendation';

/** 추천 조회 시간 초과(D5). telemetry/sender의 REQUEST_TIMEOUT_MS와 같은 값이지만 store는 domain·api만 import한다(README 의존 방향) */
export const RECOMMENDATION_TIMEOUT_MS = 5000;

export type RecommendationEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; page: RecommendationPage }
  | { status: 'hidden' };

const IDLE: RecommendationEntry = { status: 'idle' };

interface RecommendationState {
  entries: Record<string, RecommendationEntry>;
  /** `key`는 `${context}:${mode}`. 같은 키가 loading이면 아무것도 하지 않는다 */
  load: (key: string, params: FetchRecommendationsParams) => Promise<void>;
  /** 클릭 기록을 보내고 결과·오류를 모두 무시한다 */
  click: (item: RecommendationItem, requestId: string) => Promise<void>;
  /**
   * 화면을 닫을 때 끝난 결과(ready·hidden)를 버린다. 다음 마운트가 이전 추천을 잠깐 보이지 않게 하고(옛 requestId로 기록되는 것도 막는다),
   * 진행 중(loading)은 그대로 둬 StrictMode의 효과 정리에서도 요청이 한 번만 나간다(D3)
   */
  clear: (key: string) => void;
  resetForTest: () => void;
}

export const useRecommendations = create<RecommendationState>()((set, get) => ({
  entries: {},

  load: async (key, params) => {
    if (get().entries[key]?.status === 'loading') return;
    set((s) => ({ entries: { ...s.entries, [key]: { status: 'loading' } } }));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), RECOMMENDATION_TIMEOUT_MS);
    let next: RecommendationEntry;
    try {
      const page = await fetchRecommendations(params, ac.signal);
      next = page.items.length > 0 ? { status: 'ready', page } : { status: 'hidden' };
    } catch {
      next = { status: 'hidden' };
    } finally {
      clearTimeout(timer);
    }
    set((s) => ({ entries: { ...s.entries, [key]: next } }));
  },

  click: async (item, requestId) => {
    try {
      await postRecommendationClick(requestId, item.song.id);
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
