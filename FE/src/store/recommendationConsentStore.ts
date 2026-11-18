// 맞춤 곡 추천 학습 활용 동의 상태 (설계 COACH-004-recommendation-consent D4·D6, 3-3절).
// 서버(계정 단위)만 원본이다 — 로컬 저장은 하지 않는다. status: idle → loading → ready | error.
// load는 idle일 때만 요청한다(세션당 1회: StrictMode·재마운트에도 한 번). set은 PUT 뒤 응답으로 consent를 바꾸고 오류는 던진다(화면이 문구로 보인다).
// dismissed는 이번 세션만 안내 모달을 다시 띄우지 않는 메모리 플래그다(PUT 실패 시).
import { create } from 'zustand';
import { getRecommendationConsent, putRecommendationConsent } from '@/api/account/users';
import type { RecommendationConsent } from '@/domain/account/recommendationConsent';
import { recommendationVersion } from '@/domain/account/signupTerms';

export type RecommendationConsentStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RecommendationConsentState {
  status: RecommendationConsentStatus;
  /** ready일 때만 값. idle·loading·error에서는 null */
  consent: RecommendationConsent | null;
  /** 이번 세션 안내 모달 억제 */
  dismissed: boolean;
  saving: boolean;

  /** idle일 때만 GET. 성공 ready, 실패 error. 던지지 않는다 */
  load: () => Promise<void>;
  /** PUT `{ agreed, version: 현재 판 }`. 저장 중에는 무시한다. 성공하면 응답으로 consent를 바꾸고, 실패는 그대로 던진다 */
  set: (agreed: boolean) => Promise<void>;
  /** 이번 세션에는 안내 모달을 다시 띄우지 않는다 */
  dismissForSession: () => void;
  /** 로그아웃·계정 전환 때 이전 계정의 상태를 버린다 */
  reset: () => void;
  resetForTest: () => void;
}

const INITIAL = { status: 'idle', consent: null, dismissed: false, saving: false } as const;

export const useRecommendationConsent = create<RecommendationConsentState>()((set, get) => ({
  ...INITIAL,

  load: async () => {
    if (get().status !== 'idle' && get().status !== 'error') return;
    set({ status: 'loading' });
    try {
      const consent = await getRecommendationConsent();
      set({ status: 'ready', consent });
    } catch {
      set({ status: 'error', consent: null });
    }
  },

  set: async (agreed) => {
    if (get().saving) return;
    set({ saving: true });
    try {
      const consent = await putRecommendationConsent({ agreed, version: recommendationVersion() });
      set({ status: 'ready', consent });
    } finally {
      set({ saving: false });
    }
  },

  dismissForSession: () => set({ dismissed: true }),

  reset: () => set({ ...INITIAL }),

  resetForTest: () => set({ ...INITIAL }),
}));
