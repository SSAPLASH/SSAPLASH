// 「누구보다 빠르게」 집계 (설계 MODE-006-minigame-speed 3절·4절, 제한 시간·달아오름은 MODE-006-minigame-speed-ui). 순수 함수만 둔다.
// 시각은 모두 `performance.now()` 축이고, 「시작부터의 시각」은 시작 시각을 뺀 ms다. 타격 시각 고르기는 hitTime이 한다.
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { hitTime } from './hitTime';

/** 고를 수 있는 제한 시간(초). 순서는 안내 화면의 세그먼트에 보이는 순서다(설계 MODE-006-minigame-speed-ui D6·D7) */
export const SPEED_SECONDS = [5, 10] as const;
/** 제한 시간(초) */
export type SpeedSeconds = (typeof SPEED_SECONDS)[number];
/** 처음 열었을 때의 제한 시간 */
export const SPEED_DEFAULT_SECONDS: SpeedSeconds = 10;
/** 5초 판 기록의 갈래 id. 10초 판은 갈래 없는 기록이다(예전 기록이 그대로 10초 기록이다) */
const FIVE_SECONDS_VARIANT = '5s';
/** 기록 갈래 표. 순서는 목록 카드에 보일 순서이고, id가 없는 줄은 갈래 없는 기록(10초)이다 */
export const SPEED_VARIANTS = [{ name: '10초' }, { id: FIVE_SECONDS_VARIANT, name: '5초' }] as const;
/** 세는 패드(D9). 다른 패드·페달·패드를 판정하지 못한 타격은 세지 않는다 */
export const SPEED_PAD: PadId = 'SNARE';
/** 「시작!」 표시 시간(D17) */
export const GO_SHOW_MS = 600;
/** 제한 시간이 끝난 뒤 늦게 도착한 타격을 받는 시간(D8) */
export const LATE_GRACE_MS = 250;
/** 「지금 속도」를 재는 구간 */
export const RATE_WINDOW_MS = 1000;

/** 달아오름 한 단계 안의 칸 수(D11) */
const HEAT_STEPS = 5;
/** 달아오름의 마지막 단계 번호(0·1·2) */
const HEAT_MAX_TIER = 2;

/** 제한 시간(초) → ms */
export function speedDurationMs(seconds: SpeedSeconds): number {
  return seconds * 1000;
}

/** 제한 시간 → 기록의 갈래. 10초는 갈래가 없다 */
export function speedVariant(seconds: SpeedSeconds): string | undefined {
  return seconds === SPEED_DEFAULT_SECONDS ? undefined : FIVE_SECONDS_VARIANT;
}

/** 저장 글자·세그먼트 값 → 제한 시간. 모르는 값이면 기본 시간이다 */
export function parseSpeedSeconds(value: string | null | undefined): SpeedSeconds {
  return SPEED_SECONDS.find((seconds) => String(seconds) === value) ?? SPEED_DEFAULT_SECONDS;
}

/** 기록의 `detail`: 1초마다 친 횟수(제한 시간의 초 수만큼. 10초 판 10개, 5초 판 5개) */
export interface SpeedDetail {
  perSecond: number[];
}

/** 저장 값에서 읽은 `detail`이 이 게임의 모양인가 */
export function isSpeedDetail(detail: unknown): detail is SpeedDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const perSecond = (detail as { perSecond?: unknown }).perSecond;
  return (
    Array.isArray(perSecond) &&
    SPEED_SECONDS.some((seconds) => seconds === perSecond.length) &&
    perSecond.every((n) => Number.isInteger(n) && n >= 0)
  );
}

/**
 * 받아들일 타격인가. 패드가 스네어이고 집계 시각이 구간 안이면 참이다(D7·D9).
 * 구간은 시작 시각부터 제한 시간까지이고 끝 시각은 포함하지 않는다. 카운트다운 중이나 끝난 뒤에 친 타격은 여기서 걸러진다
 */
export function acceptsHit(startedAt: number, hit: Pick<ResolvedHit, 'pad' | 'tHit' | 'tRecv'>, durationMs: number): boolean {
  if (hit.pad !== SPEED_PAD) return false;
  const offset = hitTime(hit) - startedAt;
  return offset >= 0 && offset < durationMs;
}

/**
 * 그 판에 받은 타격 가운데 받아들인 것의 「시작부터의 시각」 목록(오름차순).
 * 단계가 아니라 시각으로 가리므로, 카운트다운 중에 받아 둔 타격이나 마무리 시간에 늦게 도착한 타격을 섞어 넘겨도 된다
 */
export function acceptedOffsets(
  startedAt: number,
  hits: readonly Pick<ResolvedHit, 'pad' | 'tHit' | 'tRecv'>[],
  durationMs: number,
): number[] {
  return hits
    .filter((hit) => acceptsHit(startedAt, hit, durationMs))
    .map((hit) => hitTime(hit) - startedAt)
    .sort((a, b) => a - b);
}

/** 초별 타수(제한 시간의 초 수만큼). 구간 밖 시각은 세지 않는다 */
export function secondBuckets(offsets: readonly number[], durationMs: number): number[] {
  const buckets = new Array<number>(Math.round(durationMs / 1000)).fill(0);
  for (const offset of offsets) {
    if (offset >= 0 && offset < durationMs) buckets[Math.floor(offset / 1000)] += 1;
  }
  return buckets;
}

/** 초당 타수(소수 한 자리) */
export function hitsPerSecond(count: number, durationMs: number): number {
  return Math.round((count / (durationMs / 1000)) * 10) / 10;
}

/** 지금 속도: 지금(시작부터의 ms)까지 최근 1초 동안 친 횟수 */
export function currentRate(offsets: readonly number[], now: number): number {
  let count = 0;
  for (const offset of offsets) {
    if (offset > now - RATE_WINDOW_MS && offset <= now) count += 1;
  }
  return count;
}

/** 가장 많이 친 1초. 같은 수가 여럿이면 앞선 초다. `second`는 1부터 센다 */
export function peakSecond(perSecond: readonly number[]): { count: number; second: number } {
  let best = 0;
  for (let i = 1; i < perSecond.length; i += 1) {
    if (perSecond[i] > perSecond[best]) best = i;
  }
  return { count: perSecond[best] ?? 0, second: best + 1 };
}

/** 이번 판과 이전 최고 기록의 관계. `zero`는 한 번도 못 친 판(기록을 남기지 않는다) */
export type SpeedVerdict = 'zero' | 'first' | 'best' | 'tie' | 'short';

/** `previous`는 이 판 전의 최고 기록(없으면 null) */
export function speedVerdict(score: number, previous: number | null): SpeedVerdict {
  if (score <= 0) return 'zero';
  if (previous === null) return 'first';
  if (score > previous) return 'best';
  return score === previous ? 'tie' : 'short';
}

/** 달아오름: 단계(0·1·2)와 단계 안의 칸(0~4) */
export interface SpeedHeat {
  tier: number;
  step: number;
}

/**
 * 타수가 오를수록 달아오르는 정도(D11). 칸 하나는 초 수와 같은 타수(10초 판 10타, 5초 판 5타)이고 다섯 칸이 한 단계다.
 * 그래서 10초 판은 50타·100타에서, 5초 판은 25타·50타에서 단계가 바뀐다(같은 빠르기면 같은 때다). 마지막 단계에서는 칸이 4에서 멈춘다
 */
export function speedHeat(count: number, seconds: SpeedSeconds): SpeedHeat {
  const steps = Math.floor(Math.max(0, count) / seconds);
  const tier = Math.min(HEAT_MAX_TIER, Math.floor(steps / HEAT_STEPS));
  return { tier, step: Math.min(HEAT_STEPS - 1, steps - tier * HEAT_STEPS) };
}

/** 결과 화면 제목 두 줄(설계 4절 「결과 제목」). 첫 줄은 그 판의 제한 시간으로 시작한다 */
export function speedResultTitle(score: number, previous: number | null, seconds: SpeedSeconds): readonly [string, string] {
  const first = `${seconds}초에 ${score}타.`;
  switch (speedVerdict(score, previous)) {
    case 'zero':
      return ['스네어를 한 번도 못 쳤어요.', '스틱 연결과 스네어 위치를 확인해 보세요.'];
    case 'first':
      return [first, '첫 기록이에요.'];
    case 'best':
      return [first, `지난 기록보다 ${score - (previous ?? 0)}타 많아요.`];
    case 'tie':
      return [first, '최고 기록과 같아요.'];
    default:
      return [first, `최고 기록까지 ${(previous ?? 0) - score}타 남았어요.`];
  }
}
