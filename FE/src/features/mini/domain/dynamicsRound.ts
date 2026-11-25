// 「강약중강약」 한 판의 순수 계산 (설계 MODE-006-minigame-dynamics-match 3절). 내 세기 모으기·목표 범위·숫자 목표 뽑기·오차 합·문구·눈금 위치.
// 한 판은 두 단계다. 1단계(감 잡기)는 약·중·강을 한 번씩 쳐서 내 세기를 재고, 2단계(숫자 맞추기)는 그 범위 안에서 뽑은 숫자 세 개에 맞춰 친다.
// 난수는 함수로 받고 시계는 읽지 않는다. 타이머·구독은 화면(DynamicsGamePage)이 한다.
// 받을 타격 가리기·눈금 자리·시작 가능 판정처럼 세기 게임이 같이 쓰는 계산은 domain/velocityShot에 있다. 목표 범위·최소 폭은 초안 값이라 스틱 실기 뒤 상수만 고친다(U7).
import { VELOCITY_MAX, VELOCITY_MIN, collectVelocities, type VelocityHit } from './velocityShot';

/** 단계마다의 타수(감 잡기 3타, 숫자 맞추기 3타) */
export const DYNAMICS_SHOTS = 3;
/** 감 잡기 뒤 「내 세기」를 보이는 시간. 지나면 숫자 맞추기가 저절로 시작된다(D3) */
export const FEEL_REVIEW_MS = 2500;
/** 숫자 목표가 벗어나지 않는 눈금 범위(D5). 아래는 튀어 오르며 생기는 약한 타격, 위는 상한에 붙는 값을 피한다 */
export const MATCH_FLOOR = 20;
export const MATCH_CEIL = 120;
/** 목표 범위의 최소 폭(D5). 세 번을 비슷하게 쳤어도 목표 세 개가 벌어지게 한다 */
export const MATCH_MIN_SPAN = 45;
/** 구간에서 목표를 뽑는 가운데 비율(D6). 구간 경계 근처를 빼 이웃 목표가 붙지 않게 한다 */
export const MATCH_ZONE_INNER = 0.6;
/** 한 줄 평에서 「조금」과 「많이」를 가르는 차이 */
export const NEAR_DIFF = 12;
/** 눈금 옆 내 세기 글자(약·중·강)끼리 이만큼은 떨어져야 글자를 다 보인다. 더 붙으면 겹치므로 뒤의 글자를 뺀다 */
export const MARK_LABEL_GAP = 12;
/** 마지막 타 뒤 결과로 넘어가기까지 */
export const DYNAMICS_CLOSING_MS = 1200;

export type DynamicsLevel = 'weak' | 'mid' | 'strong';

/** 감 잡기에서 치는 순서(D2) */
export const FEEL_ORDER: readonly DynamicsLevel[] = ['weak', 'mid', 'strong'];

/** 단계 글자 */
export const LEVEL_LABEL: Record<DynamicsLevel, string> = { weak: '약', mid: '중', strong: '강' };

/** 감 잡기 머리 문구 */
const FEEL_PROMPT: Record<DynamicsLevel, string> = {
  weak: '약하게 한 번.',
  mid: '중간으로 한 번.',
  strong: '강하게 한 번.',
};

/** `playing` 안의 단계: 감 잡기 · 내 세기 보이기 · 숫자 맞추기 */
export type DynamicsStep = 'feel' | 'review' | 'match';

/** 감 잡기에서 친 한 타 */
export interface FeelShot {
  level: DynamicsLevel;
  actual: number;
}

/** 숫자 맞추기에서 친 한 타. `diff`는 실제 − 목표(양수면 셈, 음수면 약함) */
export interface MatchShot {
  target: number;
  actual: number;
  diff: number;
}

/** 기록의 `detail`. `feel`은 약·중·강 차례로 친 값, `shots`는 숫자 맞추기에서 친 순서대로 세 타 */
export interface DynamicsDetail {
  feel: number[];
  shots: { target: number; actual: number }[];
}

function isVelocity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= VELOCITY_MIN && value <= VELOCITY_MAX;
}

/** 저장 값의 `detail`이 이 게임의 모양인가. 단계별 100점이던 예전 모양(`feel`이 없다)은 거짓이다(D12) */
export function isDynamicsDetail(detail: unknown): detail is DynamicsDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { feel, shots } = detail as { feel?: unknown; shots?: unknown };
  if (!Array.isArray(feel) || feel.length !== DYNAMICS_SHOTS || !feel.every(isVelocity)) return false;
  if (!Array.isArray(shots) || shots.length !== DYNAMICS_SHOTS) return false;
  return shots.every((shot: unknown) => {
    if (typeof shot !== 'object' || shot === null) return false;
    const { target, actual } = shot as Record<string, unknown>;
    return isVelocity(target) && isVelocity(actual);
  });
}

/** 0 이상 1 미만의 난수로 0..n-1 중 하나. 1이 들어와도 범위를 넘지 않는다 */
function pickIndex(random: () => number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
}

/** 감 잡기: 플레이 시작 뒤 받은 타격을 약·중·강 차례에 붙인다. 세 타까지 */
export function collectFeel(startedAt: number, hits: readonly VelocityHit[]): FeelShot[] {
  return collectVelocities(startedAt, hits, FEEL_ORDER.length).map((actual, i) => ({ level: FEEL_ORDER[i], actual }));
}

/** 숫자 맞추기: 그 단계가 시작된 뒤 받은 타격을 목표 차례에 붙인다. 목표 수까지 */
export function collectMatch(matchAt: number, hits: readonly VelocityHit[], targets: readonly number[]): MatchShot[] {
  return collectVelocities(matchAt, hits, targets.length).map((actual, i) => ({
    target: targets[i],
    actual,
    diff: actual - targets[i],
  }));
}

/** 지금 단계. 감 잡기를 다 치지 않았으면 `feel`, 숫자 맞추기가 시작되기 전이면 `review`, 시작됐으면 `match` */
export function dynamicsStep(feelCount: number, matchAt: number | null): DynamicsStep {
  if (feelCount < FEEL_ORDER.length) return 'feel';
  return matchAt === null ? 'review' : 'match';
}

/**
 * 숫자 목표를 뽑을 범위(D4·D5). 내 세기의 가장 약한 값과 가장 센 값을 20~120으로 자르고,
 * 폭이 45보다 좁으면 가운데를 지키며 45로 넓힌 뒤 20~120을 넘은 만큼 안쪽으로 민다. 값이 없으면 범위 전체다
 */
export function feelRange(values: readonly number[]): { low: number; high: number } {
  if (values.length === 0) return { low: MATCH_FLOOR, high: MATCH_CEIL };
  const clamp = (value: number) => Math.min(MATCH_CEIL, Math.max(MATCH_FLOOR, value));
  let low = clamp(Math.min(...values));
  let high = clamp(Math.max(...values));
  if (high - low < MATCH_MIN_SPAN) {
    const center = (low + high) / 2;
    low = center - MATCH_MIN_SPAN / 2;
    high = center + MATCH_MIN_SPAN / 2;
    if (low < MATCH_FLOOR) {
      high += MATCH_FLOOR - low;
      low = MATCH_FLOOR;
    }
    if (high > MATCH_CEIL) {
      low -= high - MATCH_CEIL;
      high = MATCH_CEIL;
    }
  }
  return { low, high };
}

/**
 * 한 판의 숫자 목표 3개(D4·D6). 범위를 같은 폭 셋으로 나누고, 구간마다 가운데 60% 안의 정수 하나를 뽑은 뒤 순서를 섞는다.
 * 난수는 구간 차례대로 값 뽑기에 세 번, 그 뒤 순서 섞기에 두 번 쓴다
 */
export function makeMatchTargets(values: readonly number[], random: () => number): number[] {
  const { low, high } = feelRange(values);
  const zone = (high - low) / DYNAMICS_SHOTS;
  const margin = (zone * (1 - MATCH_ZONE_INNER)) / 2;
  const targets: number[] = [];
  for (let i = 0; i < DYNAMICS_SHOTS; i += 1) {
    const from = Math.ceil(low + zone * i + margin);
    const to = Math.floor(low + zone * (i + 1) - margin);
    targets.push(from + pickIndex(random, Math.max(1, to - from + 1)));
  }
  for (let i = targets.length - 1; i > 0; i -= 1) {
    const j = pickIndex(random, i + 1);
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }
  return targets;
}

/** 기록 값: 세 타의 차이(절댓값) 합. 낮을수록 좋다(D9) */
export function matchScore(shots: readonly Pick<MatchShot, 'diff'>[]): number {
  return shots.reduce((sum, shot) => sum + Math.abs(shot.diff), 0);
}

/** 차이가 가장 큰 타. 같으면 먼저 친 타. 친 것이 없으면 null */
export function worstShot<T extends Pick<MatchShot, 'diff'>>(shots: readonly T[]): T | null {
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

/** 결과 한 줄 평. 차이가 가장 큰 타의 차례와 방향을 말하고, 차이가 12 이하면 「조금」, 넘으면 「많이」 */
export function roundRemark(shots: readonly Pick<MatchShot, 'diff'>[]): string {
  const worst = worstShot(shots);
  if (worst === null || worst.diff === 0) return '세 번 모두 딱 맞았어요.';
  const amount = Math.abs(worst.diff) <= NEAR_DIFF ? '조금' : '많이';
  const direction = worst.diff > 0 ? '셌어요' : '약했어요';
  return `${shots.indexOf(worst) + 1}타가 ${amount} ${direction}.`;
}

/** 감 잡기 머리 문구(「약하게 한 번.」) */
export function feelPrompt(level: DynamicsLevel): string {
  return FEEL_PROMPT[level];
}

/** 숫자 맞추기 머리 문구의 숫자 뒤 글. 화면이 숫자를 크게 그리고 이 글을 붙인다(「88」 + 「에 맞춰 한 번.」) */
export const MATCH_PROMPT_TAIL = '에 맞춰 한 번.';

/** 기록을 화면 글자로: 14 → 「오차 14」 */
export function formatDynamicsScore(score: number): string {
  return `오차 ${score}`;
}

/**
 * 눈금 옆에 글자를 달 내 세기 표시를 고른다. 값이 낮은 것부터 보며, 앞서 글자를 단 표시와 12 이상 떨어진 것만 글자를 단다.
 * 세 번을 비슷하게 치면 글자가 한자리에 겹치기 때문이다(작은 눈금은 모두 그리고 글자만 뺀다. 정확한 값은 「내 세기」 줄에 있다)
 */
export function labeledMarks(feel: readonly FeelShot[]): DynamicsLevel[] {
  const labeled: DynamicsLevel[] = [];
  let last: number | null = null;
  for (const shot of [...feel].sort((a, b) => a.actual - b.actual)) {
    if (last !== null && shot.actual - last < MARK_LABEL_GAP) continue;
    labeled.push(shot.level);
    last = shot.actual;
  }
  return labeled;
}

/** 결과의 점수 아래 한 줄과 「새 최고 기록」 여부. `previous`는 이 판 전의 최고 기록(없으면 null). 낮을수록 좋다 */
export function bestNote(score: number, previous: number | null): { newBest: boolean; text: string } {
  if (previous === null) return { newBest: true, text: '첫 기록이에요' };
  if (score < previous) return { newBest: true, text: `지난 최고 ${formatDynamicsScore(previous)}` };
  if (score === previous) return { newBest: false, text: '최고 기록과 같아요' };
  return { newBest: false, text: `최고 기록 ${formatDynamicsScore(previous)}` };
}
