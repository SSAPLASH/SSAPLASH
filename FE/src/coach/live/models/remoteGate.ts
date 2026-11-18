// 서버에 게시된 거름 모델을 받아 실행기를 만든다. meta.json으로 과제·입력 버전·입력 수를 확인하고,
// 파일은 매니페스트의 sha256·크기로 검증한다. 하나라도 맞지 않으면 null(그 모델을 쓰지 않는다, 설계 4.3).
// 서버 모델은 JSON 실행기만 쓴다. 동기로 끝나고, 꺼진 빌드에도 ONNX 런타임을 넣지 않아도 되기 때문이다.
import { GATE_FEATURE_VERSION, GATE_INPUT_COUNT, type CoachGate } from '../gate/gate';
import { createJsonGate, type GateWeights } from '../gate/jsonGate';
import { currentModel, fetchVerifiedJson, type FetchLike, type Manifest } from './manifest';

export const META_FILE = 'meta.json';

export interface GateMeta {
  task: 'gate';
  modelVersion: string;
  featureVersion: number;
  inputNames: string[];
  runtime: { kind: string; path: string }[];
  threshold: number;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNumbers = (x: unknown, n?: number): x is number[] =>
  Array.isArray(x) && (n === undefined || x.length === n) && x.every((v) => typeof v === 'number' && Number.isFinite(v));

/** 이 FE가 쓸 수 있는 거름 모델의 메타인지 본다. 아니면 null */
export function parseGateMeta(x: unknown): GateMeta | null {
  if (!isObject(x) || x.task !== 'gate') return null;
  if (x.featureVersion !== GATE_FEATURE_VERSION) return null;
  if (!Array.isArray(x.inputNames) || x.inputNames.length !== GATE_INPUT_COUNT) return null;
  if (typeof x.threshold !== 'number' || !Number.isFinite(x.threshold)) return null;
  if (!Array.isArray(x.runtime)) return null;
  const runtime = x.runtime.filter((r): r is { kind: string; path: string } => isObject(r) && typeof r.kind === 'string' && typeof r.path === 'string');
  return {
    task: 'gate',
    modelVersion: typeof x.modelVersion === 'string' ? x.modelVersion : '',
    featureVersion: x.featureVersion,
    inputNames: x.inputNames.map(String),
    runtime,
    threshold: x.threshold,
  };
}

/** 가중치 모양이 입력 수와 맞는지까지 본다. 맞지 않으면 null */
export function parseGateWeights(x: unknown): GateWeights | null {
  if (!isObject(x)) return null;
  const n = GATE_INPUT_COUNT;
  const { mean, scale, w1, b1, w2, b2, threshold } = x;
  if (!isNumbers(mean, n) || !isNumbers(scale, n) || scale.some((s) => s === 0)) return null;
  if (!isNumbers(b1) || b1.length === 0 || !isNumbers(b2, 1)) return null;
  if (!Array.isArray(w1) || w1.length !== n || !w1.every((row) => isNumbers(row, b1.length))) return null;
  if (!Array.isArray(w2) || w2.length !== b1.length || !w2.every((row) => isNumbers(row, 1))) return null;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null;
  return { mean, scale, w1: w1 as number[][], b1, w2: w2 as number[][], b2, threshold, modelVersion: typeof x.modelVersion === 'string' ? x.modelVersion : undefined };
}

/** 게시된 모델 이름으로 실행기를 만든다. 기록에 남는 모델 이름은 "이름@버전"이다 */
export async function loadRemoteGate(fetchFn: FetchLike, manifest: Manifest, name: string): Promise<CoachGate | null> {
  const model = currentModel(manifest, name);
  if (!model) return null;
  const meta = parseGateMeta(await fetchVerifiedJson(fetchFn, model, META_FILE));
  if (!meta) return null;
  const json = meta.runtime.find((r) => r.kind === 'json');
  if (!json) return null;
  const weights = parseGateWeights(await fetchVerifiedJson(fetchFn, model, json.path));
  if (!weights) return null;
  // 기준값은 meta.json을 따른다(같은 학습에서 나온 값이고, 게시 단위로 관리한다)
  const gate = createJsonGate({ ...weights, threshold: meta.threshold });
  return { ...gate, model: `${model.name}@${model.version}` };
}
