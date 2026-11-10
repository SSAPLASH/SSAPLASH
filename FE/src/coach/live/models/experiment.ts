// 실험 설정(coach-live-config)과 실험군 배정(설계 3.4). 설정은 모델처럼 게시해서 버전 관리와 롤백을 그대로 쓴다.
// 상태를 갖지 않는 순수 함수다.

/** 실험 설정을 게시하는 이름과 파일 */
export const CONFIG_MODEL_NAME = 'coach-live-config';
export const CONFIG_FILE = 'config.json';

export type ExperimentGateMode = 'off' | 'shadow' | 'on';

export interface Arm {
  /** 게시된 모델 이름 */
  model: string;
  /** 0~100. 같은 목록의 합이 100 */
  share: number;
}

export interface CoachLiveConfig {
  gate: { mode: ExperimentGateMode; arms: Arm[] };
  /** 원인 모델 실험군. 원인 모델이 생기기 전까지는 비어 있다 */
  cause: { arms: Arm[] };
  /** 모델을 쓰는 사용자 비율(0~100). 나머지는 규칙만 쓴다 */
  rolloutPercent: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function parseArms(x: unknown): Arm[] | null {
  if (x === undefined) return [];
  if (!Array.isArray(x)) return null;
  const arms: Arm[] = [];
  for (const a of x) {
    if (!isObject(a) || typeof a.model !== 'string' || !NAME_RE.test(a.model)) return null;
    if (typeof a.share !== 'number' || !Number.isInteger(a.share) || a.share < 0 || a.share > 100) return null;
    arms.push({ model: a.model, share: a.share });
  }
  if (arms.length > 0 && arms.reduce((s, a) => s + a.share, 0) !== 100) return null;
  return arms;
}

/** 형식이 틀리면 null(그때는 설정이 없는 것처럼 빌드 기본값으로 동작한다) */
export function parseCoachLiveConfig(x: unknown): CoachLiveConfig | null {
  if (!isObject(x) || !isObject(x.gate)) return null;
  const mode = x.gate.mode;
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'on') return null;
  const gateArms = parseArms(x.gate.arms);
  const causeArms = parseArms(isObject(x.cause) ? x.cause.arms : undefined);
  const rollout = x.rolloutPercent;
  if (gateArms === null || causeArms === null) return null;
  if (typeof rollout !== 'number' || !Number.isFinite(rollout) || rollout < 0 || rollout > 100) return null;
  return { gate: { mode, arms: gateArms }, cause: { arms: causeArms }, rolloutPercent: rollout };
}

/** 문자열을 0~99로. FNV-1a 32비트. 같은 입력이면 브라우저·기기가 달라도 같다 */
export function bucketOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** 0~99 구간에서 누적 비율로 실험군을 고른다 */
function armAt(arms: readonly Arm[], bucket: number): Arm | null {
  let acc = 0;
  for (const a of arms) {
    acc += a.share;
    if (bucket < acc) return a;
  }
  return null;
}

export interface Assignment {
  /** 모델을 쓰는 비율 안에 들었나 */
  inRollout: boolean;
  /** 고른 실험군. 비율 밖이거나 실험군이 없으면 null(규칙만) */
  arm: Arm | null;
}

/**
 * 로그인 사용자는 id로 배정해 같은 사람이 같은 실험군에 남는다. 비로그인은 판마다 무작위다.
 * 비율과 실험군은 다른 키로 나눠서, 비율을 올려도 이미 배정된 사람의 실험군이 바뀌지 않는다.
 */
export function assignGateArm(config: CoachLiveConfig, userId: number | null, random: () => number = Math.random): Assignment {
  const draw = (salt: string) => (userId === null ? Math.floor(random() * 100) : bucketOf(`${salt}:${userId}`));
  if (config.gate.mode === 'off' || config.gate.arms.length === 0) return { inRollout: false, arm: null };
  const inRollout = draw('rollout') < config.rolloutPercent;
  if (!inRollout) return { inRollout, arm: null };
  return { inRollout, arm: armAt(config.gate.arms, draw('gate')) };
}
