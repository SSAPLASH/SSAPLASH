// 서버에 게시된 놓침 원인 모델을 받아 실행기를 만든다(설계 3.1, 3.4).
// 모델은 규칙이 낸 후보와 UNKNOWN(근거 없음) 중에서만 고른다. 없는 원인을 만들지 않는다.
// 입력 계산은 AI coach_live_model/dataset.py의 cause_features와 같고, cause.parity.fixture.json으로 계산이 같은지 확인한다.
import { RULE_ORDER, UNKNOWN_CAUSE, type CauseCandidate, type MissCause } from '../cause';
import type { CoachStage } from '../config';
import type { LiveTag } from '../rules';
import { currentModel, fetchVerifiedJson, type FetchLike, type Manifest } from './manifest';
import { META_FILE } from './remoteGate';

/** 입력 계산 버전. AI의 CAUSE_FEATURE_VERSION과 같아야 한다 */
export const CAUSE_FEATURE_VERSION = 1;
/** 모델 출력 순서. AI replay.CAUSES와 같다 */
export const CAUSE_CLASSES: readonly MissCause[] = [...RULE_ORDER, 'UNKNOWN'];
const INPUT_COUNT = RULE_ORDER.length + 2;

export interface CauseModel {
  /** 기록에 남길 모델 이름(이름@버전) */
  model: string;
  /** 후보 중 하나 또는 UNKNOWN을 고른다. 후보가 없으면 UNKNOWN */
  pick(candidates: readonly CauseCandidate[], stage: CoachStage, tag: LiveTag): CauseCandidate;
}

export interface CauseLayer {
  w: number[][];
  b: number[];
  act: 'relu' | 'none';
}

export interface CauseWeights {
  mean: number[];
  scale: number[];
  layers: CauseLayer[];
}

/** 모델 입력: 원인별 후보 강도(없으면 0), 3단계 여부, 패드 놓침 지적 여부 */
export function causeFeatures(candidates: readonly CauseCandidate[], stage: CoachStage, tag: LiveTag): number[] {
  const strength = new Map(candidates.map((c) => [c.cause, c.strength]));
  return [...RULE_ORDER.map((c) => strength.get(c) ?? 0), stage >= 3 ? 1 : 0, tag === 'LIVE_PAD_MISS' ? 1 : 0];
}

/** 표준화 → 층 → softmax. 원인 5종의 확률 */
export function causeProbs(w: CauseWeights, input: readonly number[]): number[] {
  let h = input.map((v, i) => (v - w.mean[i]) / w.scale[i]);
  for (const layer of w.layers) {
    const next = layer.b.slice();
    for (let i = 0; i < h.length; i++) for (let k = 0; k < next.length; k++) next[k] += h[i] * layer.w[i][k];
    h = layer.act === 'relu' ? next.map((v) => Math.max(v, 0)) : next;
  }
  const top = Math.max(...h);
  const e = h.map((v) => Math.exp(v - top));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

export function createCauseModel(w: CauseWeights, model: string): CauseModel {
  return {
    model,
    pick(candidates, stage, tag) {
      if (candidates.length === 0) return UNKNOWN_CAUSE;
      const p = causeProbs(w, causeFeatures(candidates, stage, tag));
      // 클래스 순서로 보며 처음 나온 최댓값을 고른다(AI의 argmax와 같은 동률 처리)
      let best: CauseCandidate | null = null;
      let bestP = -1;
      CAUSE_CLASSES.forEach((cause, i) => {
        const c = cause === 'UNKNOWN' ? UNKNOWN_CAUSE : candidates.find((x) => x.cause === cause);
        if (c && p[i] > bestP) {
          best = c;
          bestP = p[i];
        }
      });
      return best ?? UNKNOWN_CAUSE;
    },
  };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNumbers = (x: unknown, n?: number): x is number[] =>
  Array.isArray(x) && (n === undefined || x.length === n) && x.every((v) => typeof v === 'number' && Number.isFinite(v));
const sameClasses = (x: unknown) => Array.isArray(x) && x.length === CAUSE_CLASSES.length && x.every((c, i) => c === CAUSE_CLASSES[i]);

/** 이 FE가 쓸 수 있는 원인 모델의 메타면 json 실행 파일 경로, 아니면 null */
export function parseCauseMeta(x: unknown): string | null {
  if (!isObject(x) || x.task !== 'cause' || x.featureVersion !== CAUSE_FEATURE_VERSION) return null;
  if (!Array.isArray(x.inputNames) || x.inputNames.length !== INPUT_COUNT || !sameClasses(x.classes)) return null;
  if (!Array.isArray(x.runtime)) return null;
  const json = x.runtime.find((r) => isObject(r) && r.kind === 'json' && typeof r.path === 'string') as { path: string } | undefined;
  return json ? json.path : null;
}

/** 층 모양이 입력 수·출력 수와 이어지는지까지 본다. 맞지 않으면 null */
export function parseCauseWeights(x: unknown): CauseWeights | null {
  if (!isObject(x) || !sameClasses(x.classes)) return null;
  const { mean, scale, layers } = x;
  if (!isNumbers(mean, INPUT_COUNT) || !isNumbers(scale, INPUT_COUNT) || scale.some((s) => s === 0)) return null;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const parsed: CauseLayer[] = [];
  let width = INPUT_COUNT;
  for (const l of layers) {
    if (!isObject(l) || (l.act !== 'relu' && l.act !== 'none') || !isNumbers(l.b) || l.b.length === 0) return null;
    const out = l.b.length;
    if (!Array.isArray(l.w) || l.w.length !== width || !l.w.every((row) => isNumbers(row, out))) return null;
    parsed.push({ w: l.w as number[][], b: l.b, act: l.act });
    width = out;
  }
  if (width !== CAUSE_CLASSES.length) return null;
  return { mean, scale, layers: parsed };
}

/** 게시된 원인 모델로 실행기를 만든다. 검증에 하나라도 실패하면 null */
export async function loadRemoteCause(fetchFn: FetchLike, manifest: Manifest, name: string): Promise<CauseModel | null> {
  const model = currentModel(manifest, name);
  if (!model) return null;
  const path = parseCauseMeta(await fetchVerifiedJson(fetchFn, model, META_FILE));
  if (!path) return null;
  const weights = parseCauseWeights(await fetchVerifiedJson(fetchFn, model, path));
  return weights ? createCauseModel(weights, `${model.name}@${model.version}`) : null;
}
