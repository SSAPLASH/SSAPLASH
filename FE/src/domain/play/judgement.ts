export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

export interface TimingWindows {
  /** ± ms */
  perfectMs: number;
  goodMs: number;
}

/** 공통 명세서 10장 가정치. 센서 정밀도 실측 후 확정 */
export const DEFAULT_TIMING: TimingWindows = { perfectMs: 25, goodMs: 60 };

/** 초보 대상 채보(쉬운 채보·입문 코스 연주 레슨)의 GOOD 폭 하한(ms). 설계 PLAY-004-timing-cal-stick-kick 3-5 */
export const BEGINNER_GOOD_MS = 90;

/** 판정에 실제로 쓰는 폭. 초보 대상이면 GOOD을 하한까지 넓히고(사용자 값이 더 넓으면 유지), PERFECT는 그대로 둔다 */
export function appliedWindows(base: TimingWindows, beginner: boolean): TimingWindows {
  if (!beginner) return base;
  return { perfectMs: base.perfectMs, goodMs: Math.max(base.goodMs, BEGINNER_GOOD_MS) };
}

/** 기본보다 넓혀 연주한 판의 GOOD 폭(ms). 기본 폭 이하이거나 값이 없으면 null */
export function wideGoodMs(timing: { goodMs: number } | null | undefined): number | null {
  const v = timing?.goodMs;
  return v != null && Number.isFinite(v) && v > DEFAULT_TIMING.goodMs ? v : null;
}

/**
 * 코칭·피드백 임계값 계산에 쓰는 고정 기준 폭(ms). 현재 기본 goodMs와 같다.
 * 판정 폭과 분리한 이유: 판정 폭은 게임 난이도이고 코칭은 실제 박에서 벗어난 정도다
 * (AI 제안, MODE-001 설계 D2). 판정 폭을 바꿔도 코칭 강도가 따라 움직이지 않게 한다.
 */
export const COACH_REF_GOOD_MS = 60;

/**
 * 판정 점수(SCORE_RULE). GOOD은 11/12 팀 결정으로 60 → 80(330번): 하나도 놓치지 않고 전부 GOOD이면 80%라
 * 입문 코스 통과 기준 70%를 넘는다. 값을 바꾸면 SCORE_RULE도 올리고 BE `ScoreRule`에 같은 버전을 더한다(업로드 검산이 버전으로 점수를 맞춘다)
 */
export const JUDGEMENT_SCORE: Record<Judgement, number> = {
  PERFECT: 100,
  GOOD: 80,
  MISS: 0,
};

/** 위 점수표의 버전. 업로드 `judgementContext.judgementVersion`으로 보낸다(SCORE_V1은 GOOD 60) */
export const SCORE_RULE = 'SCORE_V2';

export function judgeDelta(deltaMs: number, w: TimingWindows): Judgement {
  const a = Math.abs(deltaMs);
  if (a <= w.perfectMs) return 'PERFECT';
  if (a <= w.goodMs) return 'GOOD';
  return 'MISS';
}
