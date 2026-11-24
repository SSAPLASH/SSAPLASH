// 「누구보다 빠르게」 집계 (설계 MODE-006-minigame-speed 3절·4절). 순수 함수만 둔다.
// 시각은 모두 `performance.now()` 축이고, 「시작부터의 시각」은 시작 시각을 뺀 ms다. 타격 시각 고르기는 hitTime이 한다.
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { hitTime } from './hitTime';

/** 제한 시간(D5) */
export const SPEED_DURATION_MS = 10_000;
/** 세는 패드(D9). 다른 패드·페달·패드를 판정하지 못한 타격은 세지 않는다 */
export const SPEED_PAD: PadId = 'SNARE';
/** 「시작!」 표시 시간(D17) */
export const GO_SHOW_MS = 600;
/** 제한 시간이 끝난 뒤 늦게 도착한 타격을 받는 시간(D8) */
export const LATE_GRACE_MS = 250;
/** 「지금 속도」를 재는 구간 */
export const RATE_WINDOW_MS = 1000;

/** 초별 막대의 칸 수 */
const SECONDS = SPEED_DURATION_MS / 1000;

/** 기록의 `detail`: 1초마다 친 횟수(숫자 10개) */
export interface SpeedDetail {
  perSecond: number[];
}

/** 저장 값에서 읽은 `detail`이 이 게임의 모양인가 */
export function isSpeedDetail(detail: unknown): detail is SpeedDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const perSecond = (detail as { perSecond?: unknown }).perSecond;
  return Array.isArray(perSecond) && perSecond.length === SECONDS && perSecond.every((n) => Number.isInteger(n) && n >= 0);
}

/**
 * 받아들일 타격인가. 패드가 스네어이고 집계 시각이 구간 안이면 참이다(D7·D9).
 * 구간은 시작 시각부터 제한 시간까지이고 끝 시각은 포함하지 않는다. 카운트다운 중이나 끝난 뒤에 친 타격은 여기서 걸러진다
 */
export function acceptsHit(startedAt: number, hit: Pick<ResolvedHit, 'pad' | 'tHit' | 'tRecv'>): boolean {
  if (hit.pad !== SPEED_PAD) return false;
  const offset = hitTime(hit) - startedAt;
  return offset >= 0 && offset < SPEED_DURATION_MS;
}

/**
 * 그 판에 받은 타격 가운데 받아들인 것의 「시작부터의 시각」 목록(오름차순).
 * 단계가 아니라 시각으로 가리므로, 카운트다운 중에 받아 둔 타격이나 마무리 시간에 늦게 도착한 타격을 섞어 넘겨도 된다
 */
export function acceptedOffsets(startedAt: number, hits: readonly Pick<ResolvedHit, 'pad' | 'tHit' | 'tRecv'>[]): number[] {
  return hits
    .filter((hit) => acceptsHit(startedAt, hit))
    .map((hit) => hitTime(hit) - startedAt)
    .sort((a, b) => a - b);
}

/** 초별 타수 10개. 구간 밖 시각은 세지 않는다 */
export function secondBuckets(offsets: readonly number[]): number[] {
  const buckets = new Array<number>(SECONDS).fill(0);
  for (const offset of offsets) {
    if (offset >= 0 && offset < SPEED_DURATION_MS) buckets[Math.floor(offset / 1000)] += 1;
  }
  return buckets;
}

/** 초당 타수(소수 한 자리) */
export function hitsPerSecond(count: number): number {
  return Math.round((count / SECONDS) * 10) / 10;
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

/** 결과 화면 제목 두 줄(설계 4절 「결과 제목」) */
export function speedResultTitle(score: number, previous: number | null): readonly [string, string] {
  const first = `10초에 ${score}타.`;
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
