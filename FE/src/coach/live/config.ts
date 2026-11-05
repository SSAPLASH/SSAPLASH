// 실시간 코칭(COACH-001) 임계값. 수치는 모두 이 파일에만 둔다.
// 판정 폭(goodMs)에 비례하는 값은 계수로 적고, ms 값은 liveThresholds(폭)로 얻는다.
// 곱하는 폭은 coachBasisMs가 고른다(기본: 고정 기준 폭 60, 사용자 판정 폭과 분리).
// 사용자가 goodMs를 30~150ms로 바꿀 수 있어서 ms를 직접 적지 않고 기준 폭에 비례시킨다.
// 수치는 가정값이다. 직접 플레이해 보며 여기서 고친다.
import { type CoachBasis, COACH_BASIS, coachBasisMs } from '@/domain/coachBasis';
import { DEFAULT_TIMING } from '@/domain/judgement';

export { type CoachBasis, COACH_BASIS, coachBasisMs };

export const LIVE_COACH_CONFIG = {
  /** 지표를 계산하는 창 크기(판정 개수) */
  window: {
    /** 늦음·빠름·패드별·박자 지표 */
    size: 12,
    /** 손별 세기 지표(손마다 표본이 필요해서 더 넓게 본다) */
    handSize: 16,
    /** 놓침 몰림 지표 */
    missSize: 6,
  },
  /** 이 개수만큼 판정이 쌓이기 전에는 문구를 띄우지 않는다 */
  warmupJudgements: 8,
  policy: {
    /** 문구와 문구 사이 최소 간격(곡 시각 ms). 표시 3초 + 빈 칸 1초 */
    minGapMs: 4_000,
    /** 같은 tag를 다시 띄우기까지의 시간. 거두는 조건을 한 번 만족하면 건너뛴다 */
    tagCooldownMs: 10_000,
    /** 권장 표시 시간 */
    displayMs: 3_000,
  },
  /** 칭찬. 지적 후보가 없을 때만 뜬다. 안정 판단은 늦음·빠름과 박자 규칙의 거두는 문턱을 그대로 쓴다 */
  praise: {
    /** 직전 문구에서 이만큼 지나야 칭찬을 띄운다. 경향 해소 칭찬은 policy.minGapMs를 쓴다 */
    minGapMs: 6_000,
    /** 안정 칭찬에 필요한 유효 타격 수 */
    minValid: 8,
    /** 창 안의 MISS가 이보다 많으면 어떤 칭찬도 띄우지 않는다 */
    keepMaxMiss: 2,
  },
  /** 계속 늦음·빠름 */
  trend: {
    minValid: 8,
    /** 평균 |deltaMs| ≥ meanCoef × goodMs */
    meanCoef: 0.3,
    /** 같은 부호 비율 */
    sameSign: 0.75,
    /** 평균 |deltaMs| < releaseCoef × goodMs 이면 거둔다 */
    releaseCoef: 0.15,
  },
  /** 특정 패드만 늦음·빠름 */
  pad: {
    minPadHits: 4,
    /** 그 패드 타격 중 평균과 같은 방향인 비율. 우연히 흔들린 평균을 걸러낸다 */
    sameSign: 1,
    /** 패드 평균 − 창 평균의 절댓값 ≥ diffCoef × goodMs */
    diffCoef: 0.45,
    releaseCoef: 0.25,
  },
  /** 한쪽 손이 약함 */
  hand: {
    minPerHand: 4,
    /** 약한 손 평균 세기 ÷ 센 손 평균 세기 < ratio */
    ratio: 0.7,
    releaseRatio: 0.8,
  },
  /** 박자가 들쭉날쭉함 */
  unsteady: {
    minValid: 10,
    /** deltaMs 표준편차 ≥ stdCoef × goodMs */
    stdCoef: 0.5,
    releaseCoef: 0.35,
  },
  /** 연속·집중 놓침 */
  miss: {
    /** 연속 MISS 개수 */
    streak: 3,
    /** 최근 missSize개 중 MISS 개수 */
    inWindow: 4,
    /** 최근 releaseWindow개 중 MISS가 releaseMax 이하이면 거둔다 */
    releaseWindow: 4,
    releaseMax: 1,
  },
} as const;

export interface LiveThresholds {
  goodMs: number;
  trendMeanMs: number;
  trendReleaseMs: number;
  padDiffMs: number;
  padReleaseMs: number;
  unsteadyStdMs: number;
  unsteadyReleaseMs: number;
}

/** goodMs가 유한한 양수가 아니면 기본 판정 폭을 쓴다(잘못된 설정 때문에 코칭이 멈추지 않게) */
export function liveThresholds(goodMs: number): LiveThresholds {
  const g = Number.isFinite(goodMs) && goodMs > 0 ? goodMs : DEFAULT_TIMING.goodMs;
  const c = LIVE_COACH_CONFIG;
  return {
    goodMs: g,
    trendMeanMs: c.trend.meanCoef * g,
    trendReleaseMs: c.trend.releaseCoef * g,
    padDiffMs: c.pad.diffCoef * g,
    padReleaseMs: c.pad.releaseCoef * g,
    unsteadyStdMs: c.unsteady.stdCoef * g,
    unsteadyReleaseMs: c.unsteady.releaseCoef * g,
  };
}

/** 사용자 판정 폭과 방식으로 임계값을 만든다. basis를 인자로 받아 전역 설정에만 의존하지 않는다 */
export function coachThresholds(userGoodMs: number, basis: CoachBasis = COACH_BASIS): LiveThresholds {
  return liveThresholds(coachBasisMs(basis, userGoodMs));
}
