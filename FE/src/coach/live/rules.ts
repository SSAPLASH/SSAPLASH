// 실시간 코칭 규칙 5종. 지표(WindowMetrics)를 받아 "띄울 조건"과 "거둘 조건"을 평가만 한다.
// 실제로 띄울지(간격·쿨다운·상한)는 policy가 정한다. 상태를 갖지 않는 순수 함수다.
import { PAD_META, type PadId } from '@/domain/pads';
import { LIVE_COACH_CONFIG, type LiveThresholds } from './config';
import type { WindowMetrics } from './window';

export type LiveTag =
  | 'LIVE_MISS_STREAK'
  | 'LIVE_LATE'
  | 'LIVE_EARLY'
  | 'LIVE_PAD_LATE'
  | 'LIVE_PAD_EARLY'
  | 'LIVE_HAND_WEAK'
  | 'LIVE_UNSTEADY';

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
}

const PRIORITY = { miss: 0, trend: 1, pad: 2, hand: 3, unsteady: 4 } as const;
const HAND_NAME = ['왼', '오른'] as const;
const ALL_PADS = Object.keys(PAD_META) as PadId[];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function evaluateRules(m: WindowMetrics, th: LiveThresholds): RuleEvaluation[] {
  const c = LIVE_COACH_CONFIG;
  const out: RuleEvaluation[] = [];

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
  });
  out.push({
    key: 'LIVE_EARLY',
    tag: 'LIVE_EARLY',
    priority: PRIORITY.trend,
    trigger: trendEnough && mean < 0 && Math.abs(mean) >= th.trendMeanMs,
    release: mean !== null && mean >= -th.trendReleaseMs,
    severity: trendSeverity,
    text: '계속 조금 빨라요. 박을 더 기다려 보세요.',
  });

  // 특정 패드만 늦음·빠름. 창 전체 평균과 비교하되, 그 패드가 실제로 그 방향이어야 한다
  // (전체가 빠른데 한 패드만 정시인 경우를 "늦다"고 하지 않기 위해)
  for (const pad of ALL_PADS) {
    const s = m.pads.find((p) => p.pad === pad);
    const diff = s && mean !== null && s.count >= c.pad.minPadHits ? s.meanDelta - mean : null;
    const label = PAD_META[pad].label;
    const severity = s ? clamp01(Math.abs(s.meanDelta) / (1.2 * th.goodMs)) : 0;
    const release = diff !== null && Math.abs(diff) < th.padReleaseMs;
    out.push({
      key: `LIVE_PAD_LATE:${pad}`,
      tag: 'LIVE_PAD_LATE',
      priority: PRIORITY.pad,
      trigger: diff !== null && s !== undefined && diff >= th.padDiffMs && s.meanDelta > 0,
      release,
      severity,
      text: `${label}에서 유독 늦어요.`,
    });
    out.push({
      key: `LIVE_PAD_EARLY:${pad}`,
      tag: 'LIVE_PAD_EARLY',
      priority: PRIORITY.pad,
      trigger: diff !== null && s !== undefined && diff <= -th.padDiffMs && s.meanDelta < 0,
      release,
      severity,
      text: `${label}에서 유독 빨라요.`,
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
  });

  return out;
}
