// 서버 모델과 실험 설정을 받아 두고, 연주마다 쓸 거름·원인 모델을 고른다(설계 4.1, 4.2).
// - 연주를 시작할 때 refreshCoachModels를 부르면 매니페스트를 다시 읽는다. 받는 동안은 앞서 받은 것(없으면 빌드 기본값)을 쓴다.
//   그래서 매니페스트의 current를 바꾸면 FE 배포 없이 다음 연주부터 새 모델을 쓴다.
// - 실험 설정이 없거나 형식이 틀리면 지금처럼 빌드 설정(VITE_COACH_GATE)을 따르고, 원인은 규칙으로 고른다.
// - 고른 실험군의 모델을 받지 못했으면(검증 실패 포함) 그 판은 규칙만 쓴다.
// 코칭 오류가 연주를 막지 않도록 예외를 던지지 않는다.
import type { CoachGate, GateMode } from '../gate/gate';
import { assignCauseArm, assignGateArm, assignLlm, CONFIG_FILE, CONFIG_MODEL_NAME, parseCoachLiveConfig, type Arm, type CoachLiveConfig } from './experiment';
import { currentModel, fetchManifest, fetchVerifiedJson, type FetchLike, type Manifest } from './manifest';
import { loadRemoteCause, type CauseModel } from './remoteCause';
import { loadRemoteGate } from './remoteGate';

/** 실험군이 아닌 판(비율 밖, 설정 off, 모델 못 받음)의 기록 이름 */
export const RULE_ARM = 'rule';
/** LLM 구간 코칭에 배정된 판의 기록 이름 */
export const LLM_ARM = 'llm';

export interface CoachModelChoice {
  /**
   * 쓸 거름. undefined면 빌드 기본값(LiveCoach가 번들 모델을 불러온다), null이면 거름 없음.
   */
  gate: CoachGate | null | undefined;
  /** undefined면 빌드 기본값 */
  mode: GateMode | undefined;
  /** 기록에 남길 거름 실험군. 서버 설정을 따르지 않은 판은 null */
  arm: string | null;
  /** 쓸 원인 모델. null이면 규칙 순서로 고른다 */
  cause: CauseModel | null;
  /** 기록에 남길 원인 실험군. 설정에 원인 실험군이 없으면 null */
  causeArm: string | null;
  /** 연주 중 LLM 구간 코칭 모드. 배정되지 않았으면 null(요청하지 않는다) */
  llm: 'shadow' | 'on' | null;
  /** 기록에 남길 LLM 실험군('llm' 또는 'rule'). 설정에서 llm이 off면 null */
  llmArm: string | null;
}

interface State {
  config: CoachLiveConfig | null;
  /** "이름@버전" → 실행기. 받다가 실패한 것은 null */
  gates: Map<string, CoachGate | null>;
  causes: Map<string, CauseModel | null>;
  /** 실험군 모델 이름 → 지금 버전 키 */
  current: Map<string, string>;
}

const empty = (): State => ({ config: null, gates: new Map(), causes: new Map(), current: new Map() });
let state: State = empty();
let inflight: Promise<void> | null = null;

async function loadArms<T>(
  fetchFn: FetchLike,
  manifest: Manifest,
  arms: readonly Arm[],
  cache: Map<string, T | null>,
  current: Map<string, string>,
  loader: (fetchFn: FetchLike, manifest: Manifest, name: string) => Promise<T | null>,
): Promise<void> {
  for (const arm of arms) {
    const m = currentModel(manifest, arm.model);
    if (!m) continue;
    const key = `${m.name}@${m.version}`;
    current.set(arm.model, key);
    // 버전 폴더는 바뀌지 않으므로 한 번 받은 버전은 다시 받지 않는다
    if (!cache.has(key)) cache.set(key, await loader(fetchFn, manifest, arm.model));
  }
}

async function load(fetchFn: FetchLike): Promise<void> {
  const manifest: Manifest | null = await fetchManifest(fetchFn);
  if (!manifest) return; // 못 받으면 앞서 받은 상태를 그대로 쓴다
  const configModel = currentModel(manifest, CONFIG_MODEL_NAME);
  const config = configModel ? parseCoachLiveConfig(await fetchVerifiedJson(fetchFn, configModel, CONFIG_FILE)) : null;
  const gates = new Map(state.gates);
  const causes = new Map(state.causes);
  const current = new Map<string, string>();
  await loadArms(fetchFn, manifest, config?.gate.arms ?? [], gates, current, loadRemoteGate);
  await loadArms(fetchFn, manifest, config?.cause.arms ?? [], causes, current, loadRemoteCause);
  state = { config, gates, causes, current };
}

/**
 * 매니페스트와 실험 설정, 실험군 모델을 다시 받는다. 이미 받는 중이면 그 작업을 기다린다.
 * fetchFn을 주지 않으면 브라우저 fetch를 쓴다. 단위 시험(vitest)에서는 화면 시험이 실제 네트워크로 나가지 않게 건너뛴다
 */
export function refreshCoachModels(fetchFn?: FetchLike): Promise<void> {
  if (!fetchFn && import.meta.env.MODE === 'test') return Promise.resolve();
  const doFetch: FetchLike = fetchFn ?? ((url, init) => fetch(url, init));
  if (!inflight) {
    inflight = load(doFetch)
      .catch(() => undefined)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function loaded<T>(arm: Arm | null, cache: Map<string, T | null>): T | null {
  const key = arm ? state.current.get(arm.model) : undefined;
  return key ? (cache.get(key) ?? null) : null;
}

/** 이번 연주에 쓸 거름과 원인 모델. userId가 없으면(비로그인) 판마다 무작위로 배정한다 */
export function chooseCoachModel(userId: number | null, random: () => number = Math.random): CoachModelChoice {
  const { config } = state;
  if (!config) return { gate: undefined, mode: undefined, arm: null, cause: null, causeArm: null, llm: null, llmArm: null };
  const llmOn = assignLlm(config, userId);
  const llm = llmOn && config.llm.mode !== 'off' ? config.llm.mode : null;
  const llmArm = config.llm.mode === 'off' ? null : llmOn ? LLM_ARM : RULE_ARM;

  const causeArmPick = assignCauseArm(config, userId, random).arm;
  const cause = loaded(causeArmPick, state.causes);
  const causeArm = config.cause.arms.length === 0 ? null : causeArmPick && cause ? causeArmPick.model : RULE_ARM;

  if (config.gate.mode === 'off') return { gate: null, mode: undefined, arm: RULE_ARM, cause, causeArm, llm, llmArm };
  const gateArm = assignGateArm(config, userId, random).arm;
  const gate = loaded(gateArm, state.gates);
  if (!gateArm || !gate) return { gate: null, mode: config.gate.mode, arm: RULE_ARM, cause, causeArm, llm, llmArm };
  return { gate, mode: config.gate.mode, arm: gateArm.model, cause, causeArm, llm, llmArm };
}

/** 시험용 */
export function resetCoachModelsForTest(): void {
  state = empty();
  inflight = null;
}
