// 「정적 뒤 한 방」 한 판의 순수 계산 (설계 MODE-006-minigame-oneshot 3절). 보정값 고르기·한 타 판정·기록 값·표시 글·그림 자리.
// 시계·타이머·소리는 다루지 않는다. 음원 재생은 oneShotAudio, 타이머·구독은 화면(OneShotGamePage)이 한다.
// 이 게임은 소리(정답 위치)와 타격을 견준다. 리듬 게임 판정과 같은 구조라 타격 시각에서 박자 맞추기 값을 뺀다(D7).
import { isOneShotSongId } from './oneShotSongs';
import { errorSide, signedErrorMs, type TimingSide } from './timingError';

/** 허용 범위(±ms). 경계 값은 성공이다 */
export const SHOT_TOLERANCE_MS = 80;
/** 정답 뒤 이 시간까지 타격이 없으면 「치지 않음」(D8) */
export const LATE_LIMIT_MS = 1000;
/** 플레이 단계가 시작된 뒤 음원이 시작될 때까지의 여유 */
export const BACKING_LEAD_MS = 400;
/** 판정 뒤 결과로 넘어가기 전에 오차를 보이는 시간 */
export const ONE_SHOT_CLOSING_MS = 1500;
/** 그림에서 내 타격 점이 정답 선에서 벗어날 수 있는 한도(±ms) */
export const CHART_CLAMP_MS = 250;

/** 플레이 단계 안의 상태: 노래가 흐름·정적 중·판정이 남 */
export type ShotStep = 'backing' | 'rest' | 'done';

/**
 * 한 타의 결과. `success` 허용 범위 안 / `miss` 범위 밖 / `before` 정적 전에 침 / `none` 치지 않음.
 * `errorMs`는 `success`·`miss`에만 있는 정수(음수면 빠름)
 */
export type ShotOutcome = { kind: 'success' | 'miss'; errorMs: number } | { kind: 'before' | 'none' };

/** 음원 준비 상태: 받는 중·준비됨·받지 못함·곡 표와 길이가 다름 */
export type ClipState = 'loading' | 'ready' | 'failed' | 'mismatch';

/** 기록의 `detail`. 부호 있는 오차(음수면 빠름) */
export interface OneShotDetail {
  errorMs: number;
}

/** 저장 값의 `detail`이 이 게임의 모양인가 */
export function isOneShotDetail(detail: unknown): detail is OneShotDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { errorMs } = detail as Record<string, unknown>;
  return typeof errorMs === 'number' && Number.isInteger(errorMs) && Math.abs(errorMs) <= SHOT_TOLERANCE_MS;
}

/** 기록 한 줄이 맞는가: 곡 표에 있는 곡이고, 점수가 오차의 절댓값과 같다 */
export function isOneShotRecord(variant: unknown, score: number, detail: OneShotDetail): boolean {
  return isOneShotSongId(variant) && score === Math.abs(detail.errorMs);
}

/** 타격 시각에서 뺄 보정값. 발 타격이면 킥 값(따로 재지 않았으면 스틱 값), 아니면 스틱 값 */
export function shotOffsetMs(foot: boolean, stickOffsetMs: number, kickOffsetMs: number | null): number {
  return foot ? (kickOffsetMs ?? stickOffsetMs) : stickOffsetMs;
}

/**
 * 한 타를 판정한다. 타격이 정적 시작보다 이르면 `before`, 아니면 정답과의 차이가 80ms 이하면 `success`, 넘으면 `miss`.
 * 세 시각 모두 `performance.now()` 기준 ms이고, 타격 시각은 보정값을 뺀 값이다
 */
export function judgeShot(hitAt: number, restAt: number, answerAt: number): ShotOutcome {
  if (hitAt < restAt) return { kind: 'before' };
  const errorMs = signedErrorMs(hitAt, answerAt);
  return { kind: Math.abs(errorMs) <= SHOT_TOLERANCE_MS ? 'success' : 'miss', errorMs };
}

/** 기록 값: 성공이면 오차의 절댓값, 아니면 null */
export function shotScore(outcome: ShotOutcome): number | null {
  return outcome.kind === 'success' ? Math.abs(outcome.errorMs) : null;
}

/** 부호 있는 오차 글: 「+38」·「−61」·「0」 */
export function formatSigned(errorMs: number): string {
  if (errorMs === 0) return '0';
  return errorMs > 0 ? `+${errorMs}` : `−${Math.abs(errorMs)}`;
}

const SIDE_WORD: Record<TimingSide, string> = { early: '빠름', late: '늦음', exact: '정박' };

/** 빠름·늦음·정박 */
export function sideWord(errorMs: number): string {
  return SIDE_WORD[errorSide(errorMs)];
}

/** 점수 칸 아래 한 줄 */
export function shotCaption(outcome: ShotOutcome): string {
  if (outcome.kind === 'success') return `${sideWord(outcome.errorMs)} · 허용 범위 ${SHOT_TOLERANCE_MS}ms 안`;
  if (outcome.kind === 'miss') return `${sideWord(outcome.errorMs)} · 허용 범위 ${SHOT_TOLERANCE_MS}ms 밖`;
  return '잰 값이 없어요';
}

/** 「38ms 늦었어요.」·「61ms 빨랐어요.」·「정확히 맞았어요.」 */
function errorSentence(errorMs: number): string {
  if (errorMs === 0) return '정확히 맞았어요.';
  return `${Math.abs(errorMs)}ms ${errorMs > 0 ? '늦었어요' : '빨랐어요'}.`;
}

/** 결과 제목 두 줄 */
export function shotTitle(outcome: ShotOutcome): readonly [string, string] {
  switch (outcome.kind) {
    case 'success':
      return [errorSentence(outcome.errorMs), '노래가 돌아왔어요.'];
    case 'miss':
      return [errorSentence(outcome.errorMs), `${SHOT_TOLERANCE_MS}ms 안에 쳐야 노래가 돌아와요.`];
    case 'before':
      return ['정적 전에 쳤어요.', '노래가 끊긴 뒤에 한 번만 치세요.'];
    default:
      return ['치지 않았어요.', '노래가 돌아올 자리에 한 번 치세요.'];
  }
}

/** 플레이 화면에서 판정 직후 보이는 두 줄: 큰 글과 그 아래 글(없으면 빈 글) */
export function shotStageText(outcome: ShotOutcome): { value: string; caption: string } {
  if (!('errorMs' in outcome)) return { value: outcome.kind === 'before' ? '정적 전에 쳤어요' : '치지 않았어요', caption: '' };
  return { value: `${formatSigned(outcome.errorMs)} ms`, caption: `${sideWord(outcome.errorMs)} · ${outcome.kind === 'success' ? '성공' : '실패'}` };
}

/** 곡별 기록 한 줄의 값: 「38ms 늦음」·「0ms 정박」 */
export function recordText(errorMs: number): string {
  return `${Math.abs(errorMs)}ms ${sideWord(errorMs)}`;
}

/** 그 날의 자정(지역 시각)까지 내린 날짜 번호. 하루 차이를 세는 데 쓴다 */
function dayNumber(date: Date): number {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
}

/**
 * 기록한 때 글: 「방금」(이번 판에 세운 기록)·「오늘」·「어제」·「N일 전」(6일까지)·「11월 3일」.
 * `at`은 기록의 ISO 시각 문자열, `now`는 지금
 */
export function whenLabel(at: string, now: Date, fresh: boolean): string {
  if (fresh) return '방금';
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return '';
  const days = dayNumber(now) - dayNumber(then);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days <= 6) return `${days}일 전`;
  return `${then.getMonth() + 1}월 ${then.getDate()}일`;
}

/** 그림에 쓸 오차. ±250 안으로 자른다 */
export function chartOffsetMs(errorMs: number): number {
  return Math.min(CHART_CLAMP_MS, Math.max(-CHART_CLAMP_MS, errorMs));
}
