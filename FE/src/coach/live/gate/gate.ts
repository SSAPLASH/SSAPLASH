// 실시간 코칭 거름의 공통 타입과 입력 계산. 모델은 규칙이 낸 지적을 뺄 수만 있고 문구는 만들지 않는다.
// 입력 순서와 식은 AI coach_live_model/dataset.py의 features와 같다(parity.fixture.json으로 확인한다).
import type { LiveTag } from '../rules';
import type { WindowMetrics } from '../window';

export type GateRuntime = 'json' | 'onnx';
/** shadow는 판단만 기록하고, on은 기준값보다 낮은 지적을 뺀다 */
export type GateMode = 'shadow' | 'on';

export interface CoachGate {
  runtime: GateRuntime;
  threshold: number;
  /** 모델 버전. 판단 기록에 남긴다 */
  model: string;
  /** 0~1. json은 바로, onnx는 비동기로 돌려준다 */
  score(input: readonly number[]): number | Promise<number>;
}

/** 모델 판단 한 건. 진단 기록(coachGate)에 남긴다 */
export interface GateDecision {
  runtime: GateRuntime;
  tag: string;
  tMs: number;
  score: number;
  kept: boolean;
  elapsedMs: number;
}

const GATED_TAGS: readonly LiveTag[] = [
  'LIVE_MISS_STREAK',
  'LIVE_LATE',
  'LIVE_EARLY',
  'LIVE_PAD_LATE',
  'LIVE_PAD_EARLY',
  'LIVE_HAND_WEAK',
  'LIVE_UNSTEADY',
  'LIVE_PAD_MISS',
];

/**
 * 입력 계산 버전. gateFeatures의 순서·식을 바꾸면 올린다. AI coach_live_model/dataset.py의 FEATURE_VERSION과 같아야 하고,
 * 서버 모델의 meta.json 값이 다르면 그 모델을 쓰지 않는다(설계 3.4)
 */
export const GATE_FEATURE_VERSION = 1;
/** gateFeatures가 내는 입력 수 */
export const GATE_INPUT_COUNT = 12 + GATED_TAGS.length;

/** 모델이 판단하는 지적인가. 칭찬과 세팅 안내는 거르지 않는다 */
export function isGatedTag(tag: LiveTag): boolean {
  return GATED_TAGS.includes(tag);
}

export function gateFeatures(m: WindowMetrics, tag: LiveTag): number[] {
  const top = m.pads.reduce<WindowMetrics['pads'][number] | null>((best, p) => (best === null || p.count > best.count ? p : best), null);
  const [h0, h1] = m.hands;
  const high = Math.max(h0.meanVelocity, h1.meanVelocity);
  const ratio = h0.count > 0 && h1.count > 0 && high > 0 ? Math.min(h0.meanVelocity, h1.meanVelocity) / high : 1;
  const mean = m.meanDelta ?? 0;
  return [
    Math.abs(mean) / 60,
    m.sameSignRatio ?? 0,
    (m.stdDelta ?? 0) / 60,
    m.validCount / 12,
    m.missInWindow / 12,
    m.missInRecent / 6,
    m.trailingMisses / 6,
    (top?.count ?? 0) / 12,
    top ? Math.abs(top.meanDelta - mean) / 60 : 0,
    top?.sameSignRatio ?? 0,
    ratio,
    Math.min(1, m.total / 200),
    ...GATED_TAGS.map((t) => (t === tag ? 1 : 0)),
  ];
}
