// 「강약중강약」 한 판의 순수 계산 (설계 MODE-006-minigame-dynamics 3절). 목표 뽑기·받을 타격 가리기·점수·문구·눈금 위치.
// 난수는 함수로 받고 시계는 읽지 않는다. 타이머·구독은 화면(DynamicsGamePage)이 한다.
// 세기 눈금은 스틱이 내는 1~127이다(위키 EMB 「타격 감지와 패드 판정」 3장). 목표 구간·띠 폭·보호 시간은 실측에 맞춘 초안 값이라 스틱 실기 뒤 상수만 고친다(U8).
import { isSensorSource, type ResolvedHit, type SensorId } from '@/domain/events';
import { stickConnectionRequired } from '@/domain/kit/device/dockChip';
import type { PadId } from '@/domain/kit/pads';
import { hitTime } from './hitTime';

/** 한 판의 타수 */
export const DYNAMICS_SHOTS = 3;
/** 받는 패드(D4) */
export const DYNAMICS_PAD: PadId = 'SNARE';
/** 눈금 양 끝 */
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;
/** 띠의 반폭. 목표 ± 이 값이 밝은 띠다. 점수에는 쓰지 않고 한 줄 평의 「조금」·「많이」만 가른다(D7) */
export const TARGET_BAND = 12;
/** 받은 타격 뒤(그리고 플레이가 시작된 직후) 다음 타격을 받지 않는 시간(D5) */
export const SHOT_GUARD_MS = 300;
/** 3타째 뒤 결과로 넘어가기까지(D8) */
export const DYNAMICS_CLOSING_MS = 1200;
/** 「스네어를 쳐 주세요」를 보이는 시간 */
export const WRONG_PAD_HINT_MS = 1500;

export type DynamicsLevel = 'weak' | 'mid' | 'strong';

/** 단계별 목표 후보(D2). 스틱 진동 경계(약 68 이하·중 69~92·강 93 이상) 안이고 띠가 눈금을 넘지 않는다 */
export const DYNAMICS_TARGETS: Record<DynamicsLevel, readonly number[]> = {
  weak: [35, 40, 45, 50, 55],
  mid: [70, 75, 80, 85],
  strong: [100, 105, 110, 115],
};

/** 단계 글자 */
export const LEVEL_LABEL: Record<DynamicsLevel, string> = { weak: '약', mid: '중', strong: '강' };

/** 플레이 화면 머리 문구 */
const LEVEL_PROMPT: Record<DynamicsLevel, string> = {
  weak: '이번엔 약하게.',
  mid: '이번엔 중간으로.',
  strong: '이번엔 강하게.',
};

/** 한 줄 평에서 그 타를 부르는 말 */
const LEVEL_ADJECTIVE: Record<DynamicsLevel, string> = { weak: '약한', mid: '중간', strong: '강한' };

/** 한 타의 목표 */
export interface DynamicsTarget {
  level: DynamicsLevel;
  velocity: number;
}

/** 친 결과. `diff`는 실제 − 목표(양수면 셈, 음수면 약함) */
export interface DynamicsShot {
  level: DynamicsLevel;
  target: number;
  actual: number;
  diff: number;
  /** 타격 점수 0~100 */
  score: number;
}

/** 기록의 `detail`. 친 순서대로 세 타. 차이와 타격 점수는 읽을 때 다시 계산한다 */
export interface DynamicsDetail {
  shots: { level: DynamicsLevel; target: number; actual: number }[];
}

function isLevel(value: unknown): value is DynamicsLevel {
  return value === 'weak' || value === 'mid' || value === 'strong';
}

function isVelocity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= VELOCITY_MIN && value <= VELOCITY_MAX;
}

/** 저장 값의 `detail`이 이 게임의 모양인가 */
export function isDynamicsDetail(detail: unknown): detail is DynamicsDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { shots } = detail as { shots?: unknown };
  if (!Array.isArray(shots) || shots.length !== DYNAMICS_SHOTS) return false;
  return shots.every((shot: unknown) => {
    if (typeof shot !== 'object' || shot === null) return false;
    const { level, target, actual } = shot as Record<string, unknown>;
    return isLevel(level) && isVelocity(target) && isVelocity(actual);
  });
}

/** 0 이상 1 미만의 난수로 0..n-1 중 하나. 1이 들어와도 범위를 넘지 않는다 */
function pickIndex(random: () => number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
}

/**
 * 한 판의 목표 3개. 강·약·중이 한 번씩이고 순서가 섞여 있다(D1).
 * 난수는 순서 섞기에 두 번, 그 뒤 차례대로 목표 값 뽑기에 세 번 쓴다
 */
export function makeTargets(random: () => number): DynamicsTarget[] {
  const levels: DynamicsLevel[] = ['strong', 'weak', 'mid'];
  for (let i = levels.length - 1; i > 0; i -= 1) {
    const j = pickIndex(random, i + 1);
    [levels[i], levels[j]] = [levels[j], levels[i]];
  }
  return levels.map((level) => {
    const candidates = DYNAMICS_TARGETS[level];
    return { level, velocity: candidates[pickIndex(random, candidates.length)] };
  });
}

type ShotHit = Pick<ResolvedHit, 'pad' | 'source' | 'tHit' | 'tRecv'>;

/**
 * 타수로 받을 타격인가. 센서 소스의 스네어 타격이고 기준 시각(플레이 시작 시각 또는 직전에 받은 타격의 시각)에서 보호 시간이 지났어야 한다.
 * 키보드·화면 터치는 세기가 고정이라 받지 않고, 패드를 판정하지 못한 타격(세게 친 뒤 튀어 오르며 생기는 약한 타격)도 여기서 걸러진다(D4)
 */
export function acceptsShot(hit: ShotHit, since: number): boolean {
  if (!isSensorSource(hit.source) || hit.pad !== DYNAMICS_PAD) return false;
  return hitTime(hit) - since >= SHOT_GUARD_MS;
}

/** 센서 소스 타격인데 스네어가 아닌 다른 패드를 쳤는가. 패드 판정이 없는 타격은 거짓이다(안내하지 않는다) */
export function isWrongPad(hit: Pick<ResolvedHit, 'pad' | 'source'>): boolean {
  return isSensorSource(hit.source) && hit.pad !== null && hit.pad !== DYNAMICS_PAD;
}

/** 타격 점수: 100 − 차이, 0보다 작으면 0 (D6) */
export function shotScore(target: number, actual: number): number {
  return Math.max(0, 100 - Math.abs(actual - target));
}

/** 목표와 실제 세기로 친 결과를 만든다. 실제 세기는 눈금(1~127) 안의 정수로 맞춘다 */
export function toShot(target: DynamicsTarget, velocity: number): DynamicsShot {
  const actual = Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, Math.round(velocity)));
  return {
    level: target.level,
    target: target.velocity,
    actual,
    diff: actual - target.velocity,
    score: shotScore(target.velocity, actual),
  };
}

/**
 * 그 판에 받은 타격(받은 순서)에서 타수로 받을 것만 골라 친 결과로 만든다.
 * 기준 시각은 플레이 시작 시각에서 출발해 받은 타격의 시각으로 옮겨 간다. 목표 수만큼 받으면 나머지는 버린다.
 * 받은 순서대로 보므로 늦게 도착한 타격 때문에 이미 보인 결과가 바뀌지 않는다
 */
export function collectShots(
  startedAt: number,
  hits: readonly (ShotHit & Pick<ResolvedHit, 'velocity'>)[],
  targets: readonly DynamicsTarget[],
): DynamicsShot[] {
  const shots: DynamicsShot[] = [];
  let since = startedAt;
  for (const hit of hits) {
    if (shots.length >= targets.length) break;
    if (!acceptsShot(hit, since)) continue;
    shots.push(toShot(targets[shots.length], hit.velocity));
    since = hitTime(hit);
  }
  return shots;
}

/** 판 점수: 타격 점수 평균의 반올림(100점 만점). 친 것이 없으면 0 */
export function roundScore(shots: readonly Pick<DynamicsShot, 'score'>[]): number {
  if (shots.length === 0) return 0;
  return Math.round(shots.reduce((sum, shot) => sum + shot.score, 0) / shots.length);
}

/** 차이가 가장 큰 타. 같으면 먼저 친 타. 친 것이 없으면 null */
export function worstShot<T extends Pick<DynamicsShot, 'diff'>>(shots: readonly T[]): T | null {
  let worst: T | null = null;
  for (const shot of shots) {
    if (worst === null || Math.abs(shot.diff) > Math.abs(worst.diff)) worst = shot;
  }
  return worst;
}

/** 타격 차이 문구. `sentence`는 플레이 화면(「6 약했어요」), `short`는 결과 행(「6 약함」) */
export function shotRemark(diff: number, style: 'sentence' | 'short' = 'sentence'): string {
  const amount = Math.abs(diff);
  if (amount === 0) return style === 'sentence' ? '딱 맞았어요' : '딱 맞음';
  if (diff > 0) return style === 'sentence' ? `${amount} 셌어요` : `${amount} 셈`;
  return style === 'sentence' ? `${amount} 약했어요` : `${amount} 약함`;
}

/** 결과 한 줄 평. 차이가 가장 큰 타의 단계와 방향을 말하고, 띠 안이면 「조금」, 밖이면 「많이」 */
export function roundRemark(shots: readonly Pick<DynamicsShot, 'level' | 'diff'>[]): string {
  const worst = worstShot(shots);
  if (worst === null || worst.diff === 0) return '세 번 모두 딱 맞았어요.';
  const amount = Math.abs(worst.diff) <= TARGET_BAND ? '조금' : '많이';
  const direction = worst.diff > 0 ? '셌어요' : '약했어요';
  return `${LEVEL_ADJECTIVE[worst.level]} 타격이 ${amount} ${direction}.`;
}

/** 플레이 화면 머리 문구(「이번엔 약하게.」) */
export function levelPrompt(level: DynamicsLevel): string {
  return LEVEL_PROMPT[level];
}

/** 띠의 아래·위 값. 눈금 밖은 자른다 */
export function bandRange(target: number): { low: number; high: number } {
  return { low: Math.max(VELOCITY_MIN, target - TARGET_BAND), high: Math.min(VELOCITY_MAX, target + TARGET_BAND) };
}

/** 눈금 위 자리 0~1 (1이 0, 127이 1) */
export function velocityRatio(velocity: number): number {
  const ratio = (velocity - VELOCITY_MIN) / (VELOCITY_MAX - VELOCITY_MIN);
  return Math.min(1, Math.max(0, ratio));
}

/** 결과의 점수 아래 한 줄과 「새 최고 기록」 여부. `previous`는 이 판 전의 최고 점수(없으면 null) */
export function bestNote(score: number, previous: number | null): { newBest: boolean; text: string } {
  if (previous === null) return { newBest: true, text: '첫 기록이에요' };
  if (score > previous) return { newBest: true, text: `지난 최고 ${previous}점` };
  if (score === previous) return { newBest: false, text: '최고 기록과 같아요' };
  return { newBest: false, text: `최고 기록 ${previous}점` };
}

/**
 * 세기를 재는 입력이 준비됐는가(D10). 자유 연습·상단 연결 표시와 같은 판정이다.
 * 센서를 고르지 않았으면(키보드 전용) 거짓, 연결 개념이 없는 센서 소스(포인터 모의 스틱)는 참, 연결이 필요한 소스(동글·BLE)는 한 손 이상 연결돼야 참
 */
export function canStartDynamics(sensorKind: SensorId, hasUsageGuide: boolean, connected: readonly [boolean, boolean]): boolean {
  if (sensorKind === 'none') return false;
  if (!stickConnectionRequired(sensorKind, hasUsageGuide)) return true;
  return connected[0] || connected[1];
}
