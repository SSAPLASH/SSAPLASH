// 실시간 코칭(COACH-001) 임계값. 수치는 모두 이 파일에만 둔다.
// 판정 폭(goodMs)에 비례하는 값은 계수로 적고, ms 값은 liveThresholds(폭)로 얻는다.
// 곱하는 폭은 coachBasisMs가 고른다(기본: 고정 기준 폭 60, 사용자 판정 폭과 분리).
// 사용자가 goodMs를 30~150ms로 바꿀 수 있어서 ms를 직접 적지 않고 기준 폭에 비례시킨다.
// 수치는 가정값이다. 직접 플레이해 보며 여기서 고친다.
import { type CoachBasis, COACH_BASIS, coachBasisMs } from '@/domain/play/coachBasis';
import { DEFAULT_TIMING } from '@/domain/play/judgement';

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
    /** 패드별 놓침 지표(패드마다 표본이 필요해서 더 넓게 본다) */
    padMissSize: 16,
  },
  /**
   * 판정 단계(설계 3.2). 한 판에서 쌓인 판정 수에 따라 코칭을 점점 자세하게 한다.
   * 적은 표본으로 원인을 단정하면 틀리기 쉬워서, 근거가 쌓일수록 말할 수 있는 것을 늘린다.
   */
  stages: {
    /** 이 수 전에는 아무것도 띄우지 않는다. 여기부터 1단계: 연속 놓침만 */
    first: 4,
    /** 2단계: 규칙 지적 전부와 칭찬. 근거가 충분한 원인(빠른 구간, 다른 패드)만 붙인다 */
    second: 8,
    /** 3단계: 원인 후보 전부 */
    third: 16,
  },
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
    /** 창 안의 MISS가 이보다 많으면 어떤 칭찬도 띄우지 않는다. 0이라 놓침이 하나라도 있으면 칭찬하지 않는다 */
    keepMaxMiss: 0,
    /** 일반 칭찬(LIVE_GOOD_KEEP)은 직전 문구(지적·칭찬 모두)에서 이만큼 지나야 띄운다. 빈 칭찬이 잦지 않게 한다 */
    keepMinGapMs: 20_000,
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
  /** 놓침이 한 패드에 몰림 */
  padMiss: {
    /** 창 안의 전체 MISS가 이만큼은 있어야 몰림을 판단한다 */
    minTotalMisses: 4,
    /** 그 패드의 MISS 개수 */
    minMisses: 3,
    /** 전체 MISS 중 그 패드의 비율 */
    share: 0.6,
    /** 그 패드 노트 중 MISS 비율. 노트가 많은 패드가 우연히 많이 놓친 것처럼 보이지 않게 한다 */
    rate: 0.5,
    /** 그 패드의 MISS가 이 이하이면 거둔다 */
    releaseMax: 1,
  },
  /** 세팅 안내. 기기 지연은 판정 폭과 무관해서 ms로 적는다. 스틱 입력에서 플레이당 태그별 한 번만 뜬다 */
  setup: {
    /** 판단에 쓰는 최근 판정 수 */
    window: 16,
    /** 소리 지연: 유효 타격 수, 평균 |deltaMs| 하한, 표준편차 상한, 같은 부호 비율 */
    minValid: 16,
    offsetMeanMs: 45,
    offsetMaxStdMs: 20,
    offsetSameSign: 0.9,
    /** 패드 위치: 판정 중 MISS 비율, MISS 대비 채보 밖 타격 비율 */
    padsMissRate: 0.5,
    padsStrayRatio: 0.5,
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
  /** 놓침 원인(설계 3.1). 창 안 기록을 노트 시각 순으로 정렬해서 본다 */
  cause: {
    /** 원인을 보는 최근 판정 수 */
    window: 16,
    /** 원인을 말하려면 창 안(대상 패드가 있으면 그 패드) MISS가 이만큼은 있어야 한다 */
    minMisses: 2,
    /** 빠른 구간: 놓친 노트의 직전 간격 ≤ gapRatio × 곡의 노트 간격 중앙값인 놓침의 비율 */
    dense: { gapRatio: 0.6, share: 0.6 },
    /** 다른 패드: 놓친 노트 시각 ± nearCoef × goodMs 안에 다른 패드의 채보 밖 타격이 있는 놓침의 비율 */
    wrongPad: { nearCoef: 2, share: 0.5 },
    /**
     * 패드 이동: 같은 이동(A → B)에서 놓친 횟수, 놓침 중 그 이동의 비율, 그 이동 노트 중 놓친 비율.
     * 같은 B를 A가 아닌 곳에서 넘어와 친 노트(비교 대상)가 minContrast개 이상 있고, 그 이동의 놓침 비율이
     * 비교 대상 놓침 비율의 lift배 이상이어야 한다(설계 U14). 같은 이동만 반복되는 채보에서는 무작위 놓침도
     * 이동 탓처럼 보여서, 비교할 수 없으면 이동으로 보지 않는다
     */
    transition: { minRepeat: 2, share: 0.5, rate: 0.5, minContrast: 2, lift: 2.5 },
    /**
     * 늦어지다 놓침: 놓침 묶음 직전 lookback개 유효 타격이 모두 늦고, 마지막이 lateCoef × goodMs 이상,
     * 처음보다 riseCoef × goodMs 이상 늦어졌다. 그런 놓침 묶음의 비율
     */
    drift: { lookback: 3, lateCoef: 0.3, riseCoef: 0.2, share: 0.5 },
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

/** 판정 단계. 0이면 아무것도 띄우지 않는다 */
export type CoachStage = 0 | 1 | 2 | 3;

/** 이 판에서 받은 판정 수로 단계를 정한다. 재시작하면 판정 수가 0으로 돌아가 1단계 전부터 다시 시작한다 */
export function coachStage(judged: number): CoachStage {
  const s = LIVE_COACH_CONFIG.stages;
  if (judged >= s.third) return 3;
  if (judged >= s.second) return 2;
  if (judged >= s.first) return 1;
  return 0;
}

/** 1단계에서 띄울 수 있는 태그. 근거가 적어도 확실한 연속 놓침만 */
export const STAGE1_TAGS: readonly string[] = ['LIVE_MISS_STREAK'];

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
