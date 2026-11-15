// 악보 연습에서 고른 연습 속도(설계 MODE-003-practice-speed D4). 저장하지 않는다(새로고침하면 100 %).
// 같은 채보를 이어서 치는 동안(다시 하기, 결과에서 다시 하기)만 유지하고, 다른 곡·단계를 고르면 100 %로 읽힌다.
// 결과 화면에 다녀오면 악보 페이지가 다시 마운트되므로 컴포넌트 state가 아니라 여기에 둔다.
import { create } from 'zustand';
import { sanitizeRate } from '@/domain/song/practiceRate';

interface PracticeRateState {
  /** 이 배율을 고른 채보(곡 id:채보 id). 다른 채보에서는 무시한다 */
  key: string | null;
  rate: number;
  setRate: (key: string, rate: number) => void;
}

export const usePracticeRate = create<PracticeRateState>((set) => ({
  key: null,
  rate: 1,
  setRate: (key, rate) => set({ key, rate: sanitizeRate(rate) }),
}));

/** 채보 키. 곡·채보 id를 모르면 null(고른 값이 없다) */
export function practiceRateKey(songId: number | null, chartId: number | null): string | null {
  return songId === null || chartId === null ? null : `${songId}:${chartId}`;
}

/** 이 채보에서 고른 배율. 다른 채보에서 고른 값이면 1 */
export function rateFor(state: Pick<PracticeRateState, 'key' | 'rate'>, key: string | null): number {
  return key !== null && state.key === key ? state.rate : 1;
}
