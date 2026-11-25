// 「어디까지 올라가는 거예요?」 한 판의 순수 계산 (설계 MODE-006-minigame-crescendo 3절). 받은 타격으로 계단 만들기·끝난 까닭·횟수·문구·기록 값.
// 약하게 시작해서 칠 때마다 앞 타격보다 세게 쳐야 이어진다. 같거나 약하면 그 판이 끝나고, 몇 번 이어 갔는지가 기록이다.
// 받을 타격 가리기는 세기 게임 공용(domain/velocityShot)을 쓴다. 시계·타이머는 다루지 않는다(화면 CrescendoGamePage가 한다).
import { VELOCITY_MAX, VELOCITY_MIN, collectVelocities, type VelocityHit } from './velocityShot';

/** 직전 계단보다 이만큼은 세야 이어진다(D2). 초안 값이라 스틱 실기 뒤 이 값만 고친다 */
export const CRESCENDO_MIN_STEP = 1;
/** 끝난 뒤 결과로 넘어가기까지. 끝낸 타격이 얼마나 모자랐는지 볼 틈이다(D8) */
export const CRESCENDO_CLOSING_MS = 1500;
/** 첫 타가 이 값 이상이면 한 줄 평이 「시작이 셌어요」가 된다(눈금의 가운데) */
export const STRONG_START = 64;

/** 끝난 까닭: 직전보다 세지 않게 침 · 127(꼭대기)에 닿음 */
export type CrescendoEnd = 'fell' | 'top';

/**
 * 지금까지의 판. `steps`는 받은 순서의 계단(세기), `end`가 null이면 진행 중이다.
 * `fell`로 끝났으면 `last`에 끝낸 타격의 세기가 있고, 그 밖에는 null이다
 */
export interface CrescendoRun {
  steps: number[];
  end: CrescendoEnd | null;
  last: number | null;
}

/** 기록의 `detail`. 받은 계단의 세기와 끝낸 타격의 세기(꼭대기에 닿아 끝났으면 null) */
export interface CrescendoDetail {
  steps: number[];
  last: number | null;
}

function isVelocity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= VELOCITY_MIN && value <= VELOCITY_MAX;
}

/**
 * 저장 값의 `detail`이 이 게임의 모양인가. 계단이 하나 이상이고 뒤로 갈수록 세며,
 * 끝낸 타격이 있으면 마지막 계단을 넘지 못한 값이고, 없으면 마지막 계단이 꼭대기(127)다
 */
export function isCrescendoDetail(detail: unknown): detail is CrescendoDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { steps, last } = detail as { steps?: unknown; last?: unknown };
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(isVelocity)) return false;
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i] < steps[i - 1] + CRESCENDO_MIN_STEP) return false;
  }
  const top = steps[steps.length - 1];
  if (last === null) return top === VELOCITY_MAX;
  return isVelocity(last) && last < top + CRESCENDO_MIN_STEP;
}

/** 기록 한 줄이 맞는가: 점수가 계단 수와 같다 */
export function isCrescendoRecord(score: number, detail: CrescendoDetail): boolean {
  return score === detail.steps.length;
}

/**
 * 받은 타격의 세기(받은 순서)로 판을 만든다. 첫 타는 계단에 넣고, 그 뒤는 직전 계단보다 1 이상 세면 넣는다.
 * 세지 않으면 `fell`로 끝내고 그 세기를 `last`에 둔다. 127을 넣으면 `top`으로 끝낸다. 끝난 뒤의 세기는 보지 않는다
 */
export function buildRun(velocities: readonly number[]): CrescendoRun {
  const steps: number[] = [];
  for (const velocity of velocities) {
    const previous = steps[steps.length - 1];
    if (previous !== undefined && velocity < previous + CRESCENDO_MIN_STEP) return { steps, end: 'fell', last: velocity };
    steps.push(velocity);
    if (velocity >= VELOCITY_MAX) return { steps, end: 'top', last: null };
  }
  return { steps, end: null, last: null };
}

/** 그 판에 받은 타격(받은 순서)으로 판을 만든다. 플레이 시작보다 이른 타격과 보호 시간 안의 타격은 빠진다 */
export function collectRun(startedAt: number, hits: readonly VelocityHit[]): CrescendoRun {
  return buildRun(collectVelocities(startedAt, hits));
}

/** 기록 값: 이어 간 횟수(계단 수). 끝낸 타격은 세지 않는다(D5) */
export function runScore(run: Pick<CrescendoRun, 'steps'>): number {
  return run.steps.length;
}

/** 다음 타격이 이 값 이상이어야 이어진다(직전 계단 + 1). 첫 타 전이거나 끝난 판이면 null */
export function nextFloor(run: CrescendoRun): number | null {
  if (run.end !== null || run.steps.length === 0) return null;
  return run.steps[run.steps.length - 1] + CRESCENDO_MIN_STEP;
}

/** 이웃 계단 사이 간격의 평균(소수 첫째 자리). 계단이 둘 미만이면 null */
export function averageStep(run: Pick<CrescendoRun, 'steps'>): number | null {
  const { steps } = run;
  if (steps.length < 2) return null;
  return Math.round(((steps[steps.length - 1] - steps[0]) / (steps.length - 1)) * 10) / 10;
}

/** 진행 중 머리 문구의 숫자 뒤 글. 화면이 직전 계단의 숫자를 크게 그리고 이 글을 붙인다(「42」 + 「보다 세게.」) */
export const CLIMB_PROMPT_TAIL = '보다 세게.';

/** 플레이 화면 머리 문구. 진행 중이면 숫자(직전 계단)와 뒤 글을 따로 준다 */
export function runPrompt(run: CrescendoRun): { lead: number | null; text: string } {
  const top = run.steps[run.steps.length - 1];
  if (run.end === 'top') return { lead: null, text: '꼭대기까지 올랐어요.' };
  if (run.end === 'fell') return { lead: top, text: '보다 세지 못했어요.' };
  if (top === undefined) return { lead: null, text: '약하게 시작하세요.' };
  return { lead: top, text: CLIMB_PROMPT_TAIL };
}

/** 플레이 화면 머리 아래 글. 끝난 판이면 빈 글 */
export function runHint(run: CrescendoRun): string {
  if (run.end !== null) return '';
  return run.steps.length === 0 ? '약할수록 오를 계단이 많아요.' : '조금만 더 세게 치세요.';
}

/**
 * 결과 한 줄 평. 꼭대기에 닿았으면 그 말, 첫 타가 셌으면(64 이상) 더 약하게 시작하라는 말,
 * 아니면 끝낸 타격이 직전과 같았는지·얼마나 약했는지
 */
export function runRemark(run: CrescendoRun): string {
  if (run.end === 'top') return '꼭대기까지 올랐어요.';
  if (run.steps.length > 0 && run.steps[0] >= STRONG_START) return '시작이 셌어요. 더 약하게 시작해 보세요.';
  const top = run.steps[run.steps.length - 1];
  if (run.end !== 'fell' || run.last === null || top === undefined) return '';
  const short = top - run.last;
  return short <= 0 ? '마지막이 앞과 같았어요.' : `마지막이 앞보다 ${short} 약했어요.`;
}

/** 결과의 점수 아래 한 줄과 「새 최고 기록」 여부. `previous`는 이 판 전의 최고 기록(없으면 null). 높을수록 좋다 */
export function bestNote(score: number, previous: number | null): { newBest: boolean; text: string } {
  if (previous === null) return { newBest: true, text: '첫 기록이에요' };
  if (score > previous) return { newBest: true, text: `지난 최고 ${previous}번` };
  if (score === previous) return { newBest: false, text: '최고 기록과 같아요' };
  return { newBest: false, text: `최고 기록 ${previous}번` };
}
