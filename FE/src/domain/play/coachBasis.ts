// 코칭·피드백 임계값 기준 방식(MODE-001 설계 D2·D6). 실시간 코칭(coach/live)과 결과 피드백(domain/feedback)이 같이 쓴다.
import { COACH_REF_GOOD_MS } from './judgement';

/**
 * 코칭 임계값에 곱하는 폭을 고르는 방식.
 * fixed: 고정 기준 폭(COACH_REF_GOOD_MS), window: 그 플레이의 사용자 판정 폭(이전 동작).
 * 판정 폭과 분리한 이유: 판정=난이도, 코칭=실제 박 오차(AI 제안, MODE-001 설계 D2).
 * 두 방식 비교용으로 남긴다(D6). 실시간 코칭·결과 피드백이 같은 설정을 쓴다.
 */
export type CoachBasis = 'fixed' | 'window';
export const COACH_BASIS: CoachBasis = 'fixed';

/** basis에 따라 임계값 계산에 쓸 폭(ms). window에서 잘못된 값은 liveThresholds가 기본 폭으로 대체한다 */
export function coachBasisMs(basis: CoachBasis, userGoodMs: number): number {
  return basis === 'window' ? userGoodMs : COACH_REF_GOOD_MS;
}
