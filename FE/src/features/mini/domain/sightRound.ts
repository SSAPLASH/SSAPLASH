// 「악보 보고 빨리 치기」 한 판의 순수 계산 (설계 MODE-006-minigame-sight 3절). 출제·타격 가리기·문제 시간·평균·표시 형식·한 줄 평·막대 눈금.
// 난수는 함수로 받고 시계는 읽지 않는다. 문제 상태(대기·제시·확인)의 진행은 domain/sightPlay, 타이머·구독은 화면(SightGamePage)이 한다.
// 간격·미리 친 타격 범위·확인 시간은 초안 값이라 스틱 실기 뒤 상수만 고친다(U7).
import { pedalRequired } from '@/domain/kit/device/pedalStatus';
import { ALL_PADS, PAD_META, STICK_PADS, type PadId } from '@/domain/kit/pads';

/** 한 판의 문제 수 */
export const SIGHT_PROBLEMS = 10;
/** 페달이 있어야 내는 패드(D2). 나머지 7종은 스틱으로 치는 패드(STICK_PADS)다 */
export const SIGHT_KICK: PadId = 'KICK';
/** 문제 사이 무작위 간격(D6) */
export const WAIT_MIN_MS = 1000;
export const WAIT_MAX_MS = 2500;
/** 음표가 뜬 뒤 이 시간 안의 타격은 미리 친 것으로 본다(D8). 보고 칠 수 없는 시간이다 */
export const EARLY_GUARD_MS = 100;
/** 틀린 타격 한 번의 벌점(D7) */
export const WRONG_PENALTY_MS = 500;
/** 한 문제의 상한(D10). 벌점을 더한 문제 시간도 이 값을 넘지 않는다 */
export const PROBLEM_LIMIT_MS = 5000;
/** 맞힌 뒤 결과를 보이는 시간. 마지막 문제 뒤의 마무리 시간도 같다 */
export const HOLD_MS = 800;
/** 「아직이에요」·「틀렸어요」를 보이는 시간 */
export const NOTICE_MS = 1500;
/** 평균을 반올림하는 단위(D11). 화면에 보이는 자리(초 소수 둘째 자리)와 같다 */
export const SCORE_STEP_MS = 10;
/** 결과 막대 눈금 끝의 아래·위 한도 */
export const BAR_MIN_MS = 1000;
export const BAR_MAX_MS = 2000;

/** 힌트 켬·끔. 기록의 갈래는 `sightVariant` */
export type SightHint = 'on' | 'off';
/** 문제 상태: 대기(음표 없음)·제시(음표 뜸)·확인(맞혔거나 시간 초과) */
export type SightStep = 'wait' | 'shown' | 'hold';
/** 타격 하나를 가린 결과 */
export type SightVerdict = 'early' | 'correct' | 'wrong' | 'ignore';

/** 끝난 문제 하나. `ms`는 벌점을 더하고 상한을 적용한 문제 시간(정수) */
export interface SightAnswer {
  pad: PadId;
  ms: number;
  wrongs: number;
  timedOut: boolean;
}

/** 기록의 `detail`. 낸 순서대로 10문제 */
export interface SightDetail {
  problems: SightAnswer[];
}

/** 기록의 갈래 id와 카드에 보일 이름. 순서는 카드에 보일 순서다(힌트 끔이 본 기록, D15) */
export const SIGHT_VARIANTS = [
  { id: 'hint-off', name: '힌트 끔' },
  { id: 'hint-on', name: '힌트 켬' },
] as const;

/** 힌트 값 → 기록의 갈래 */
export function sightVariant(hint: SightHint): 'hint-on' | 'hint-off' {
  return hint === 'on' ? 'hint-on' : 'hint-off';
}

function isAnswer(value: unknown): value is SightAnswer {
  if (typeof value !== 'object' || value === null) return false;
  const { pad, ms, wrongs, timedOut } = value as Record<string, unknown>;
  if (typeof pad !== 'string' || !(ALL_PADS as readonly string[]).includes(pad)) return false;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > PROBLEM_LIMIT_MS) return false;
  if (typeof wrongs !== 'number' || !Number.isInteger(wrongs) || wrongs < 0) return false;
  return typeof timedOut === 'boolean';
}

/** 저장 값의 `detail`이 이 게임의 모양인가 */
export function isSightDetail(detail: unknown): detail is SightDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { problems } = detail as { problems?: unknown };
  return Array.isArray(problems) && problems.length === SIGHT_PROBLEMS && problems.every(isAnswer);
}

/**
 * 킥 문제를 낼 수 있는가(D2). 키보드 전용이면 킥 키가 있어 참, 동글이면 킥 페달이 연결됐을 때 참,
 * 그 밖의 센서 소스(포인터·BLE 등)는 페달이 올 수 없어 거짓이다
 */
export function canAskKick(sensorKind: string, kickPedalConnected: boolean): boolean {
  if (sensorKind === 'none') return true;
  return pedalRequired(sensorKind) && kickPedalConnected;
}

/** 출제 패드. 킥을 낼 수 있으면 8종, 아니면 스틱으로 치는 7종 */
export function sightPads(withKick: boolean): PadId[] {
  return withKick ? [...STICK_PADS, SIGHT_KICK] : [...STICK_PADS];
}

/** 0 이상 1 미만의 난수로 0..n-1 중 하나. 1이 들어와도 범위를 넘지 않는다 */
function pickIndex(random: () => number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = pickIndex(random, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 이웃한 자리에 같은 패드가 없는가. `before`는 목록 바로 앞에 놓인 패드(없으면 넘기지 않는다) */
function noRepeat(list: readonly PadId[], before?: PadId): boolean {
  let prev = before;
  for (const pad of list) {
    if (pad === prev) return false;
    prev = pad;
  }
  return true;
}

/** 조건에 맞는 순서를 찾을 때까지 다시 섞는 횟수. 겹치는 패드가 많아야 세 쌍이라 몇 번 안에 찾는다 */
const SHUFFLE_TRIES = 200;

/** 이웃이 겹치는 자리를 다른 자리와 바꿔 푼다. 다시 섞기로 못 찾았을 때만 쓴다 */
function untangle(list: PadId[]): PadId[] {
  for (let i = 1; i < list.length; i += 1) {
    if (list[i] !== list[i - 1]) continue;
    for (let j = 0; j < list.length; j += 1) {
      if (j === i || j === i - 1) continue;
      const swapped = [...list];
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      const okAt = (k: number) => (k <= 0 || swapped[k] !== swapped[k - 1]) && (k >= swapped.length - 1 || swapped[k] !== swapped[k + 1]);
      if (okAt(i) && okAt(j)) {
        list = swapped;
        break;
      }
    }
  }
  return list;
}

/**
 * 한 판의 문제(D3). 출제 패드가 모두 한 번 이상 나오고 어떤 패드도 두 번을 넘지 않으며, 같은 패드가 연달아 나오지 않는다.
 * 모자라는 수만큼 서로 다른 패드를 한 번씩 더 넣고 섞는다
 */
export function makeProblems(pads: readonly PadId[], random: () => number, count: number = SIGHT_PROBLEMS): PadId[] {
  if (pads.length === 0) return [];
  const extras = shuffled(pads, random).slice(0, Math.max(0, count - pads.length));
  const pool = [...pads, ...extras].slice(0, count);
  for (let attempt = 0; attempt < SHUFFLE_TRIES; attempt += 1) {
    const list = shuffled(pool, random);
    if (noRepeat(list)) return list;
  }
  return untangle(shuffled(pool, random));
}

/**
 * 지금 문제부터 끝까지를 다시 섞은 목록(D8). 앞 문제와 이어지는 자리에도 같은 패드가 오지 않는다.
 * 방금 보인 음표가 그대로 다시 나오지 않게, 남은 문제에 다른 패드가 있으면 지금 자리에는 다른 패드를 둔다.
 * 그런 순서가 없으면(남은 문제가 하나뿐일 때 등) 순서를 그대로 둔다
 */
export function reshuffleRest(problems: readonly PadId[], at: number, random: () => number): PadId[] {
  const head = problems.slice(0, at);
  const rest = problems.slice(at);
  if (rest.length <= 1) return [...problems];
  const before = head.length > 0 ? head[head.length - 1] : undefined;
  const shown = rest[0];
  let fallback: PadId[] | null = null;
  for (let attempt = 0; attempt < SHUFFLE_TRIES; attempt += 1) {
    const list = shuffled(rest, random);
    if (!noRepeat(list, before)) continue;
    if (list[0] !== shown) return [...head, ...list];
    fallback ??= list;
  }
  return fallback ? [...head, ...fallback] : [...problems];
}

/** 문제 사이 간격(ms). 1000~2500 사이 정수 */
export function waitMs(random: () => number): number {
  const ms = Math.round(WAIT_MIN_MS + random() * (WAIT_MAX_MS - WAIT_MIN_MS));
  return Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, ms));
}

/**
 * 타격 하나를 가린다. 패드를 판정하지 못한 타격은 `ignore`(틀림으로도 미리 친 것으로도 세지 않는다).
 * 제시 시각이 없거나(대기 중, 또는 음표를 그리는 프레임이 지나기 전) 제시 뒤 0.1초 안이면 `early`. 그 밖에 목표 패드면 `correct`, 아니면 `wrong`.
 * `at`은 집계에 쓸 타격 시각(domain/hitTime)이다
 */
export function judgeHit(hit: { pad: PadId | null; at: number }, target: PadId, shownAt: number | null): SightVerdict {
  if (hit.pad === null) return 'ignore';
  if (shownAt === null || hit.at - shownAt < EARLY_GUARD_MS) return 'early';
  return hit.pad === target ? 'correct' : 'wrong';
}

/** 문제 시간: 걸린 시간에 벌점을 더한 정수 ms. 상한을 넘지 않는다 */
export function problemMs(shownAt: number, hitAt: number, wrongs: number): number {
  const taken = Math.max(0, Math.round(hitAt - shownAt)) + wrongs * WRONG_PENALTY_MS;
  return Math.min(PROBLEM_LIMIT_MS, taken);
}

/** 평균을 10 ms 단위로 반올림한 값. 끝난 문제가 없으면 0 */
export function averageMs(answers: readonly Pick<SightAnswer, 'ms'>[]): number {
  if (answers.length === 0) return 0;
  const mean = answers.reduce((sum, answer) => sum + answer.ms, 0) / answers.length;
  return Math.round(mean / SCORE_STEP_MS) * SCORE_STEP_MS;
}

/** ms → 초 소수 둘째 자리 글자(420 → 「0.42」) */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/** 맞힌 문제 수(시간 초과가 아닌 문제) */
export function solvedCount(answers: readonly Pick<SightAnswer, 'timedOut'>[]): number {
  return answers.filter((answer) => !answer.timedOut).length;
}

/** 틀린 타격의 합 */
export function wrongCount(answers: readonly Pick<SightAnswer, 'wrongs'>[]): number {
  return answers.reduce((sum, answer) => sum + answer.wrongs, 0);
}

/** 결과 한 줄 평. 시간 초과가 있으면 그것을, 없고 틀린 타격이 있으면 그 횟수를 말한다 */
export function sightRemark(answers: readonly Pick<SightAnswer, 'wrongs' | 'timedOut'>[]): string {
  const timeouts = answers.length - solvedCount(answers);
  if (timeouts > 0) return `${timeouts}문제는 시간이 다 됐어요.`;
  const wrongs = wrongCount(answers);
  if (wrongs > 0) return `${wrongs}번 틀렸어요.`;
  return '한 번도 안 틀렸어요.';
}

/** 결과 제목 두 줄. 한 문제도 못 맞혔으면 기록 대신 확인할 것을 알린다 */
export function sightResultTitle(answers: readonly SightAnswer[]): readonly [string, string] {
  if (solvedCount(answers) === 0) return ['한 문제도 못 맞혔어요.', '스틱 연결과 패드 위치를 확인해 보세요.'];
  return [`평균 ${formatSeconds(averageMs(answers))}초.`, sightRemark(answers)];
}

/** 결과의 점수 아래 한 줄과 「새 최고 기록」 여부. 낮을수록 좋다. `previous`는 이 판 전의 최고 기록(ms, 없으면 null) */
export function sightBestNote(score: number, previous: number | null): { newBest: boolean; text: string } {
  if (previous === null) return { newBest: true, text: '첫 기록이에요' };
  if (score < previous) return { newBest: true, text: `지난 최고 ${formatSeconds(previous)}초` };
  if (score === previous) return { newBest: false, text: '최고 기록과 같아요' };
  return { newBest: false, text: `최고 기록 ${formatSeconds(previous)}초까지 ${formatSeconds(score - previous)}초` };
}

/** 결과 막대 눈금 끝(ms). 가장 긴 문제 시간을 1000~2000 안으로 자른 값 */
export function barScaleMs(answers: readonly Pick<SightAnswer, 'ms'>[]): number {
  const longest = answers.reduce((max, answer) => Math.max(max, answer.ms), 0);
  return Math.min(BAR_MAX_MS, Math.max(BAR_MIN_MS, longest));
}

/** 패드 이름(「스네어」). 확인 문구와 결과 행이 쓴다 */
export function padName(pad: PadId): string {
  return PAD_META[pad].label;
}

/**
 * 결과 막대의 두 부분(눈금 끝에 대한 비율 0~1). `base`는 맞히기까지 걸린 시간, `penalty`는 틀려서 더해진 시간이다.
 * 둘의 합은 1을 넘지 않는다(눈금을 넘는 막대는 끝까지 채운다)
 */
export function barParts(answer: Pick<SightAnswer, 'ms' | 'wrongs'>, scaleMs: number): { base: number; penalty: number } {
  if (scaleMs <= 0) return { base: 0, penalty: 0 };
  const penaltyMs = Math.min(answer.ms, answer.wrongs * WRONG_PENALTY_MS);
  const base = Math.min(1, (answer.ms - penaltyMs) / scaleMs);
  return { base, penalty: Math.min(1 - base, penaltyMs / scaleMs) };
}

/** 받침이 있는 글자로 끝나는가(한글 음절만 본다). 「킥이었어요」·「스네어였어요」를 가른다 */
function endsWithBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/**
 * 문제 판의 한 줄 문구와 색조. 확인 중이면 답을 알려 주고(힌트와 상관없이 패드 이름), 알림이 떠 있으면 그 알림을, 그 밖에는 지금 할 일을 말한다.
 * `last`는 방금 끝난 문제(확인 중일 때만 쓴다)
 */
export function sightMessage(
  step: SightStep,
  notice: 'early' | 'wrong' | null,
  last: Pick<SightAnswer, 'pad' | 'timedOut'> | null,
): { text: string; tone: 'plain' | 'good' | 'bad' } {
  if (step === 'hold' && last !== null) {
    const name = padName(last.pad);
    if (last.timedOut) return { text: `시간이 다 됐어요. ${name}${endsWithBatchim(name) ? '이었어요' : '였어요'}.`, tone: 'bad' };
    return { text: `${name}, 맞았어요.`, tone: 'good' };
  }
  if (step === 'shown') {
    return notice === 'wrong' ? { text: '틀렸어요. 0.5초가 더해졌어요.', tone: 'bad' } : { text: '이 음표의 패드를 치세요.', tone: 'plain' };
  }
  if (notice === 'early') return { text: '아직이에요. 음표가 뜬 뒤에 치세요.', tone: 'bad' };
  return { text: '음표가 뜨면 바로 치세요.', tone: 'plain' };
}
