// 「악보 보고 빨리 치기」 문제 진행 상태 기계 (설계 MODE-006-minigame-sight 4절 「문제 하나」). 순수 함수 — 시계·난수·타이머는 화면이 사건에 실어 넘긴다.
// 문제 하나는 대기(음표 없음) → 제시(음표 뜸) → 확인(맞혔거나 시간 초과)을 돈다. 미리 친 타격은 그 문제를 무효로 하고 남은 문제를 다시 섞어 대기부터 다시 한다.
import type { PadId } from '@/domain/kit/pads';
import { PROBLEM_LIMIT_MS, judgeHit, problemMs, reshuffleRest, type SightAnswer, type SightStep } from './sightRound';

/** 문제 판 위에 잠깐 보이는 알림. `seq`는 알림마다 오른다(같은 알림이 이어져도 시간을 다시 잰다) */
export interface SightNotice {
  kind: 'early' | 'wrong';
  seq: number;
}

export interface SightPlay {
  /** 낼 문제(낸 순서). 미리 친 타격이 나오면 지금 문제부터 끝까지가 다시 섞인다 */
  problems: readonly PadId[];
  /** 끝난 문제(낸 순서). 길이가 지금 문제의 번호(0부터)다 */
  answers: readonly SightAnswer[];
  step: SightStep;
  /** 음표가 그려진 프레임의 시각(performance.now 축). 대기·확인 중과, 제시로 넘어온 뒤 그 프레임이 지나기 전에는 null */
  shownAt: number | null;
  /** 지금 문제에서 틀린 타격 수 */
  wrongs: number;
  notice: SightNotice | null;
  /** 대기를 새로 시작할 때마다 오른다. 화면이 이 값으로 대기 타이머를 다시 건다 */
  waitSeq: number;
  /** 이미 본 타격 id. 같은 타격이 두 번 들어가지 않게 한다 */
  seen: readonly number[];
}

export type SightEvent =
  /** 대기 시간이 지나 음표를 낸다 */
  | { type: 'show' }
  /** 음표를 그린 프레임이 지났다. `at`은 그때의 시각 */
  | { type: 'painted'; at: number }
  /** 타격. `at`은 집계에 쓸 타격 시각(domain/hitTime), `seed`는 다시 섞을 때 쓸 난수 씨앗 */
  | { type: 'hit'; id: number; pad: PadId | null; at: number; seed: number }
  /** 한 문제의 상한 시간이 지났다 */
  | { type: 'timeout' }
  /** 확인 시간이 지나 다음 문제로 간다 */
  | { type: 'next' }
  /** 알림 시간이 지났다. 그사이 새 알림이 떴으면(순번이 다르면) 그대로 둔다 */
  | { type: 'clearNotice'; seq: number };

/** 새 판의 처음 상태: 첫 문제의 대기 */
export function startSight(problems: readonly PadId[]): SightPlay {
  return { problems, answers: [], step: 'wait', shownAt: null, wrongs: 0, notice: null, waitSeq: 0, seen: [] };
}

/** 지금 문제의 패드. 문제를 다 냈으면 null */
export function currentPad(play: Pick<SightPlay, 'problems' | 'answers'>): PadId | null {
  return play.problems[play.answers.length] ?? null;
}

/** 문제를 다 냈는가(마지막 문제가 확인에 들어갔다) */
export function sightFinished(play: Pick<SightPlay, 'problems' | 'answers'>): boolean {
  return play.problems.length > 0 && play.answers.length >= play.problems.length;
}

/** 씨앗 하나로 만드는 난수 함수(mulberry32). 상태 기계가 순수하게 남도록 난수를 씨앗으로 받는다 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextSeq(notice: SightNotice | null): number {
  return (notice?.seq ?? 0) + 1;
}

function onHit(play: SightPlay, event: Extract<SightEvent, { type: 'hit' }>): SightPlay {
  // 확인 중과 문제를 다 낸 뒤의 타격은 받지 않는다
  const target = currentPad(play);
  if (play.step === 'hold' || target === null) return play;
  if (play.seen.includes(event.id)) return play;
  const seen = [...play.seen, event.id];
  switch (judgeHit({ pad: event.pad, at: event.at }, target, play.step === 'shown' ? play.shownAt : null)) {
    case 'ignore':
      return { ...play, seen };
    case 'early':
      // 그 문제를 무효로 하고 지금 문제와 남은 문제를 다시 섞어 대기부터 다시 한다
      return {
        ...play,
        seen,
        problems: reshuffleRest(play.problems, play.answers.length, seededRandom(event.seed)),
        step: 'wait',
        shownAt: null,
        wrongs: 0,
        notice: { kind: 'early', seq: nextSeq(play.notice) },
        waitSeq: play.waitSeq + 1,
      };
    case 'wrong':
      return { ...play, seen, wrongs: play.wrongs + 1, notice: { kind: 'wrong', seq: nextSeq(play.notice) } };
    default: {
      // correct: 제시 시각이 있어야 여기까지 온다(없으면 early)
      const answer: SightAnswer = {
        pad: target,
        ms: problemMs(play.shownAt ?? event.at, event.at, play.wrongs),
        wrongs: play.wrongs,
        timedOut: false,
      };
      return { ...play, seen, answers: [...play.answers, answer], step: 'hold', notice: null };
    }
  }
}

/** 사건 하나를 받아 다음 상태를 돌려준다. 그 상태에서 뜻이 없는 사건이면 받은 상태를 그대로 돌려준다 */
export function stepSight(play: SightPlay, event: SightEvent): SightPlay {
  switch (event.type) {
    case 'show':
      return play.step === 'wait' && currentPad(play) !== null ? { ...play, step: 'shown', shownAt: null } : play;
    case 'painted':
      return play.step === 'shown' && play.shownAt === null ? { ...play, shownAt: event.at } : play;
    case 'hit':
      return onHit(play, event);
    case 'timeout': {
      const target = currentPad(play);
      if (play.step !== 'shown' || target === null) return play;
      const answer: SightAnswer = { pad: target, ms: PROBLEM_LIMIT_MS, wrongs: play.wrongs, timedOut: true };
      return { ...play, answers: [...play.answers, answer], step: 'hold', notice: null };
    }
    case 'next':
      if (play.step !== 'hold' || sightFinished(play)) return play;
      return { ...play, step: 'wait', shownAt: null, wrongs: 0, notice: null, waitSeq: play.waitSeq + 1 };
    case 'clearNotice':
      return play.notice !== null && play.notice.seq === event.seq ? { ...play, notice: null } : play;
    default:
      return play;
  }
}
