// 실시간 코칭(COACH-001) 임계값. 수치는 모두 이 파일에만 둔다.
// 판정 폭(goodMs)에 비례하는 값은 계수로 적고, ms 값은 liveThresholds(goodMs)로 얻는다.
// 사용자가 goodMs를 30~150ms로 바꿀 수 있어서(설정) 고정 ms를 쓰지 않는다.
// 수치는 가정값이다. 직접 플레이해 보며 여기서 고친다.
import { DEFAULT_TIMING } from '@/domain/judgement';

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
    /** 문구와 문구 사이 최소 간격(곡 시각 ms) */
    minGapMs: 8_000,
    /** 같은 tag를 다시 띄우기까지의 시간. 거두는 조건을 한 번 만족하면 건너뛴다 */
    tagCooldownMs: 25_000,
    /** 플레이당 문구 상한 */
    maxPerPlay: 10,
    /** 권장 표시 시간 */
    displayMs: 3_000,
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
