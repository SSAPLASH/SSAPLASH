// 실시간 코칭 규칙. 지적 6종은 지표(WindowMetrics)를 받아 "띄울 조건"과 "거둘 조건"을 평가만 하고,
// 칭찬은 지금 연주 상태에 맞는 후보 하나를 고른다. 실제로 띄울지(간격·쿨다운)는 policy가 정한다.
// 상태를 갖지 않는 순수 함수다.
import { STICK_PADS, type PadId } from '@/domain/kit/pads';
import { LIVE_COACH_CONFIG, type LiveThresholds } from './config';
import { coachPadName, objectParticle } from './padName';
import type { WindowMetrics } from './window';

export type LiveTag =
  | 'LIVE_SETUP_OFFSET'
  | 'LIVE_SETUP_PADS'
  | 'LIVE_PAD_MISS'
  | 'LIVE_MISS_STREAK'
  | 'LIVE_LATE'
  | 'LIVE_EARLY'
  | 'LIVE_PAD_LATE'
  | 'LIVE_PAD_EARLY'
  | 'LIVE_HAND_WEAK'
  | 'LIVE_UNSTEADY'
  | 'LIVE_GOOD_RECOVERED'
  | 'LIVE_GOOD_STEADY'
  | 'LIVE_GOOD_KEEP'
  /** 연주 중 LLM 구간 코칭 문구(규칙이 아니라 LiveCoach.offerLlmTip이 만든다) */
  | 'LIVE_LLM';

/** 칭찬 태그인가. 효과 평가와 방식 비교는 지적 태그만 본다 */
export function isPraiseTag(tag: string): boolean {
  return tag.startsWith('LIVE_GOOD_');
}

/** 문구의 대상. 패드 규칙은 패드, 손 규칙은 손(0 왼손·1 오른손), 그 외는 null */
export type CoachTarget = { kind: 'pad'; pad: PadId } | { kind: 'hand'; hand: 0 | 1 };

export interface RuleEvaluation {
  /** 상태를 구분하는 키. 패드·손 규칙은 대상까지 포함한다(예: LIVE_PAD_LATE:SNARE) */
  key: string;
  /** 플레이 로그에 남는 태그 */
  tag: LiveTag;
  /** 작을수록 먼저. 한 번에 하나만 띄울 때 고르는 기준 */
  priority: number;
  /** 지금 문구를 띄울 만한 상태인가 */
  trigger: boolean;
  /** 경향이 사라졌다고 볼 수 있는가(거두는 문턱을 만족). 계산할 수 없을 때는 false */
  release: boolean;
  /** 0~1. 같은 우선순위 안에서 고르는 기준 */
  severity: number;
  /** 한국어 완성 문장, FE가 그대로 표시 */
  text: string;
  /** 패드·손 규칙만 채운다. 화면 문구가 "{패드}만 늦어요"를 만들 때 쓴다 */
  target: CoachTarget | null;
}

// 놓침이 한 패드에 몰렸으면 전체 놓침보다 구체적인 안내를 먼저 띄운다
const PRIORITY = { padMiss: 0, miss: 1, trend: 2, pad: 3, hand: 4, unsteady: 5, praise: 6 } as const;
const HAND_NAME = ['왼', '오른'] as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function praise(tag: LiveTag, text: string): RuleEvaluation {
  return { key: tag, tag, priority: PRIORITY.praise, trigger: true, release: false, severity: 0, text, target: null };
}

/** 띄웠던 지적의 경향이 사라졌을 때 쓰는 칭찬 */
export const RECOVERED_PRAISE = praise('LIVE_GOOD_RECOVERED', '좋아요! 지적한 경향이 고쳐졌어요.');

/** 지금 연주에 맞는 칭찬 후보. 놓침이 많으면 null(잘 못 치는데 칭찬하지 않는다) */
export function evaluatePraise(m: WindowMetrics, th: LiveThresholds): RuleEvaluation | null {
  const c = LIVE_COACH_CONFIG.praise;
  if (m.missInWindow > c.keepMaxMiss) return null;
  const steady =
    m.missInWindow === 0 &&
    m.validCount >= c.minValid &&
    m.meanDelta !== null &&
    Math.abs(m.meanDelta) < th.trendReleaseMs &&
    m.stdDelta !== null &&
    m.stdDelta < th.unsteadyReleaseMs;
  return steady ? praise('LIVE_GOOD_STEADY', '좋아요! 이대로만 치세요.') : praise('LIVE_GOOD_KEEP', '잘 따라오고 있어요.');
}

export function evaluateRules(m: WindowMetrics, th: LiveThresholds): RuleEvaluation[] {
  const c = LIVE_COACH_CONFIG;
  const out: RuleEvaluation[] = [];

  // 놓침이 한 패드에 몰림. 노트가 많은 패드가 우연히 많이 놓친 것처럼 보이지 않게 그 패드의 놓침 비율도 본다.
  // 페달은 입력 기준이 정해지기 전이라 평가하지 않는다(STICK_PADS만)
  for (const pad of STICK_PADS) {
    const s = m.padMisses.find((p) => p.pad === pad);
    const misses = s?.misses ?? 0;
    const rate = s && s.notes > 0 ? misses / s.notes : 0;
    const name = coachPadName(pad);
    out.push({
      key: `LIVE_PAD_MISS:${pad}`,
      tag: 'LIVE_PAD_MISS',
      priority: PRIORITY.padMiss,
      trigger:
        m.missInPadWindow >= c.padMiss.minTotalMisses &&
        misses >= c.padMiss.minMisses &&
        misses / m.missInPadWindow >= c.padMiss.share &&
        rate >= c.padMiss.rate,
      release: misses <= c.padMiss.releaseMax,
      severity: clamp01(rate),
      text: `${name}${objectParticle(name)} 자주 놓치고 있어요. ${name}에 집중해 보세요.`,
      target: { kind: 'pad', pad },
    });
  }

  // 연속·집중 놓침
  const missRate = Math.max(m.missInRecent, m.trailingMisses) / c.window.missSize;
  out.push({
    key: 'LIVE_MISS_STREAK',
    tag: 'LIVE_MISS_STREAK',
    priority: PRIORITY.miss,
    trigger: m.trailingMisses >= c.miss.streak || m.missInRecent >= c.miss.inWindow,
    release: m.missInRelease <= c.miss.releaseMax,
    severity: clamp01(missRate / 0.6),
    text: '놓치고 있어요. 박자에 맞춰 천천히 다시 따라와 보세요.',
    target: null,
  });

  // 계속 늦음·빠름. 거두는 조건은 부호를 본다(방향이 뒤집힌 뒤 같은 방향이 다시 오면 새로 띄울 수 있게)
  const mean = m.meanDelta;
  const trendEnough =
    mean !== null && m.validCount >= c.trend.minValid && (m.sameSignRatio ?? 0) >= c.trend.sameSign;
  const trendSeverity = mean === null ? 0 : clamp01(Math.abs(mean) / (1.2 * th.goodMs));
  out.push({
    key: 'LIVE_LATE',
    tag: 'LIVE_LATE',
    priority: PRIORITY.trend,
    trigger: trendEnough && mean > 0 && Math.abs(mean) >= th.trendMeanMs,
    release: mean !== null && mean <= th.trendReleaseMs,
    severity: trendSeverity,
    text: '계속 조금 늦어요. 살짝 앞서서 쳐 보세요.',
    target: null,
  });
  out.push({
    key: 'LIVE_EARLY',
    tag: 'LIVE_EARLY',
    priority: PRIORITY.trend,
    trigger: trendEnough && mean < 0 && Math.abs(mean) >= th.trendMeanMs,
    release: mean !== null && mean >= -th.trendReleaseMs,
    severity: trendSeverity,
    text: '계속 조금 빨라요. 박을 더 기다려 보세요.',
    target: null,
  });

  // 특정 패드만 늦음·빠름. "나머지 패드의 평균"과 비교한다. 창 전체 평균과 비교하면 그 패드 자신이
  // 평균을 끌어당겨 차이가 희석된다(노트의 절반이 그 패드면 차이가 절반으로 줄어든다).
  // 나머지 표본이 모자라면 비교하지 않는다(창 대부분이 그 패드면 전체 늦음·빠름 규칙이 맡는다).
  // 그 패드가 실제로 그 방향이어야 한다(나머지가 빠른데 정시인 패드를 "늦다"고 하지 않기 위해).
  // 페달(킥·하이햇 페달)은 입력 기준이 정해지기 전이라 평가하지 않는다(STICK_PADS만)
  for (const pad of STICK_PADS) {
    const s = m.pads.find((p) => p.pad === pad);
    const othersCount = s ? m.validCount - s.count : 0;
    const othersMean =
      s && mean !== null && othersCount >= c.pad.minPadHits ? (m.validCount * mean - s.count * s.meanDelta) / othersCount : null;
    const diff = s && s.count >= c.pad.minPadHits && othersMean !== null ? s.meanDelta - othersMean : null;
    const label = coachPadName(pad);
    const severity = s ? clamp01(Math.abs(s.meanDelta) / (1.2 * th.goodMs)) : 0;
    const release = diff !== null && Math.abs(diff) < th.padReleaseMs;
    out.push({
      key: `LIVE_PAD_LATE:${pad}`,
      tag: 'LIVE_PAD_LATE',
      priority: PRIORITY.pad,
      trigger: diff !== null && s !== undefined && diff >= th.padDiffMs && s.meanDelta > 0 && s.sameSignRatio >= c.pad.sameSign,
      release,
      severity,
      text: `${label}에서 유독 늦어요.`,
      target: { kind: 'pad', pad },
    });
    out.push({
      key: `LIVE_PAD_EARLY:${pad}`,
      tag: 'LIVE_PAD_EARLY',
      priority: PRIORITY.pad,
      trigger: diff !== null && s !== undefined && diff <= -th.padDiffMs && s.meanDelta < 0 && s.sameSignRatio >= c.pad.sameSign,
      release,
      severity,
      text: `${label}에서 유독 빨라요.`,
      target: { kind: 'pad', pad },
    });
  }

  // 한쪽 손이 약함. 키는 약한 손 기준이다
  const [h0, h1] = m.hands;
  const handsOk = h0.count >= c.hand.minPerHand && h1.count >= c.hand.minPerHand && h0.meanVelocity > 0 && h1.meanVelocity > 0;
  for (const hand of [0, 1] as const) {
    const mine = m.hands[hand];
    const other = m.hands[hand === 0 ? 1 : 0];
    const ratio = handsOk ? mine.meanVelocity / other.meanVelocity : null;
    out.push({
      key: `LIVE_HAND_WEAK:${hand}`,
      tag: 'LIVE_HAND_WEAK',
      priority: PRIORITY.hand,
      trigger: ratio !== null && ratio < c.hand.ratio,
      release: ratio !== null && ratio >= c.hand.releaseRatio,
      severity: ratio === null ? 0 : clamp01((1 - ratio) / 0.5),
      text: `${HAND_NAME[hand]}손이 약해요. 양손 세기를 맞춰 보세요.`,
      target: { kind: 'hand', hand },
    });
  }

  // 박자가 들쭉날쭉함
  const std = m.stdDelta;
  out.push({
    key: 'LIVE_UNSTEADY',
    tag: 'LIVE_UNSTEADY',
    priority: PRIORITY.unsteady,
    trigger: std !== null && m.validCount >= c.unsteady.minValid && std >= th.unsteadyStdMs,
    release: std !== null && std < th.unsteadyReleaseMs,
    severity: std === null ? 0 : clamp01(std / (0.8 * th.goodMs)),
    text: '박자가 들쭉날쭉해요. 일정한 속도를 유지해 보세요.',
    target: null,
  });

  return out;
}
