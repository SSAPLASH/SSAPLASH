import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import { currentPad, seededRandom, sightFinished, startSight, stepSight, type SightEvent, type SightPlay } from './sightPlay';

const PROBLEMS: PadId[] = ['SNARE', 'KICK', 'HIHAT', 'CRASH', 'RIDE', 'MID_TOM', 'SMALL_TOM', 'FLOOR_TOM', 'SNARE', 'HIHAT'];

let nextId = 1;
function hit(pad: PadId | null, at: number, seed = 1, id = nextId++): SightEvent {
  return { type: 'hit', id, pad, at, seed };
}

function run(play: SightPlay, ...events: SightEvent[]): SightPlay {
  return events.reduce(stepSight, play);
}

/** 제시까지 간 상태(음표가 1000에 그려졌다) */
function shown(problems: readonly PadId[] = PROBLEMS, at = 1000): SightPlay {
  return run(startSight(problems), { type: 'show' }, { type: 'painted', at });
}

function sorted(list: readonly PadId[]): PadId[] {
  return [...list].sort();
}

function adjacentDup(list: readonly PadId[]): boolean {
  return list.some((pad, i) => i > 0 && pad === list[i - 1]);
}

describe('startSight·currentPad·sightFinished', () => {
  it('처음 상태는 첫 문제의 대기', () => {
    const play = startSight(PROBLEMS);
    expect(play.step).toBe('wait');
    expect(play.answers).toEqual([]);
    expect(play.shownAt).toBeNull();
    expect(play.wrongs).toBe(0);
    expect(play.notice).toBeNull();
    expect(play.waitSeq).toBe(0);
    expect(play.problems).toEqual(PROBLEMS);
  });

  it('currentPad는 첫 문제, 다 풀면 null', () => {
    expect(currentPad(startSight(PROBLEMS))).toBe('SNARE');
    const done = { problems: ['SNARE'] as PadId[], answers: [{ pad: 'SNARE' as PadId, ms: 300, wrongs: 0, timedOut: false }] };
    expect(currentPad(done)).toBeNull();
  });

  it('sightFinished', () => {
    expect(sightFinished(startSight(PROBLEMS))).toBe(false);
    expect(sightFinished({ problems: ['SNARE'], answers: [{ pad: 'SNARE', ms: 300, wrongs: 0, timedOut: false }] })).toBe(true);
    expect(sightFinished({ problems: [], answers: [] })).toBe(false);
  });
});

describe('seededRandom', () => {
  it('같은 씨앗은 같은 수열', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('값은 [0, 1)', () => {
    const r = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('씨앗이 다르면 수열이 다르다', () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });
});

describe('show·painted', () => {
  it('대기에서 show는 제시로, shownAt은 아직 null', () => {
    const play = run(startSight(PROBLEMS), { type: 'show' });
    expect(play.step).toBe('shown');
    expect(play.shownAt).toBeNull();
  });

  it('제시·확인에서 show는 같은 객체를 돌려준다', () => {
    const play = run(startSight(PROBLEMS), { type: 'show' });
    expect(stepSight(play, { type: 'show' })).toBe(play);
    const hold = run(shown(), hit('SNARE', 1300));
    expect(hold.step).toBe('hold');
    expect(stepSight(hold, { type: 'show' })).toBe(hold);
  });

  it('painted는 제시에서 shownAt이 null일 때만 값을 넣고, 두 번째는 덮지 않는다', () => {
    const base = run(startSight(PROBLEMS), { type: 'show' });
    const first = stepSight(base, { type: 'painted', at: 500 });
    expect(first.shownAt).toBe(500);
    expect(stepSight(first, { type: 'painted', at: 900 }).shownAt).toBe(500);
  });

  it('대기·확인에서 painted는 무시한다', () => {
    const wait = startSight(PROBLEMS);
    expect(stepSight(wait, { type: 'painted', at: 500 })).toBe(wait);
    const hold = run(shown(), hit('SNARE', 1300));
    expect(stepSight(hold, { type: 'painted', at: 5000 })).toBe(hold);
  });
});

describe('hit: 미리 침(early)', () => {
  it('대기 중 타격은 early: 대기 유지, 알림, waitSeq 증가, 남은 문제 재배열', () => {
    const play = stepSight(startSight(PROBLEMS), hit('SNARE', 500, 3));
    expect(play.step).toBe('wait');
    expect(play.notice).toEqual({ kind: 'early', seq: 1 });
    expect(play.waitSeq).toBe(1);
    expect(play.wrongs).toBe(0);
    expect(play.answers).toEqual([]);
    expect(sorted(play.problems)).toEqual(sorted(PROBLEMS));
  });

  it('제시 중이지만 음표를 그리기 전의 타격도 early', () => {
    const play = run(startSight(PROBLEMS), { type: 'show' }, hit('SNARE', 800));
    expect(play.step).toBe('wait');
    expect(play.shownAt).toBeNull();
    expect(play.notice?.kind).toBe('early');
  });

  it('제시 뒤 99 ms 안은 early, 100 ms에 맞는 패드면 correct', () => {
    const early = stepSight(shown(), hit('SNARE', 1099));
    expect(early.step).toBe('wait');
    expect(early.notice?.kind).toBe('early');
    const ok = stepSight(shown(), hit('SNARE', 1100));
    expect(ok.answers).toEqual([{ pad: 'SNARE', ms: 100, wrongs: 0, timedOut: false }]);
    expect(ok.step).toBe('hold');
    expect(ok.notice).toBeNull();
  });

  it('틀린 뒤 미리 치면 이 문제의 틀림 수가 0으로 돌아간다', () => {
    const play = run(shown(), hit('KICK', 1300), hit('SNARE', 1350));
    // 1350은 제시 뒤 350 ms라 맞힘이다. 미리 침은 아래에서 다시 확인한다
    expect(play.step).toBe('hold');
    const early = run(shown(), hit('KICK', 1300), hit('SNARE', 1050));
    expect(early.step).toBe('wait');
    expect(early.wrongs).toBe(0);
    expect(early.notice?.kind).toBe('early');
  });

  it('다시 섞어도 푼 문제(앞부분)는 그대로이고 이웃이 겹치지 않는다', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const solved = run(
        shown(),
        hit('SNARE', 1300),
        { type: 'next' },
        { type: 'show' },
        { type: 'painted', at: 2000 },
        hit('KICK', 2300),
        { type: 'next' },
      );
      expect(solved.answers).toHaveLength(2);
      const waiting = run(solved, hit('HIHAT', 2400, seed));
      expect(waiting.step).toBe('wait');
      expect(waiting.problems.slice(0, 2)).toEqual(PROBLEMS.slice(0, 2));
      expect(sorted(waiting.problems.slice(2))).toEqual(sorted(PROBLEMS.slice(2)));
      expect(adjacentDup(waiting.problems.slice(1))).toBe(false);
    }
  });
});

describe('hit: 틀림·맞힘', () => {
  it('틀린 패드는 벌점 1, 알림, 제시 유지, shownAt 그대로. 그 뒤 맞히면 벌점이 더해진다', () => {
    const wrong = stepSight(shown(), hit('KICK', 1300));
    expect(wrong.wrongs).toBe(1);
    expect(wrong.notice).toEqual({ kind: 'wrong', seq: 1 });
    expect(wrong.step).toBe('shown');
    expect(wrong.shownAt).toBe(1000);
    const ok = stepSight(wrong, hit('SNARE', 1700));
    expect(ok.answers).toEqual([{ pad: 'SNARE', ms: 1200, wrongs: 1, timedOut: false }]);
    expect(ok.step).toBe('hold');
  });

  it('틀린 타격이 이어지면 알림 순번이 오른다', () => {
    const a = stepSight(shown(), hit('KICK', 1300));
    const b = stepSight(a, hit('HIHAT', 1400));
    expect(b.wrongs).toBe(2);
    expect(a.notice?.seq).toBe(1);
    expect(b.notice?.seq).toBe(2);
  });

  it('패드를 모르는 타격은 기억만 하고 아무것도 바꾸지 않는다(대기)', () => {
    const play = stepSight(startSight(PROBLEMS), { type: 'hit', id: 9, pad: null, at: 100, seed: 1 });
    expect(play).toEqual({ ...startSight(PROBLEMS), seen: [9] });
  });

  it('패드를 모르는 타격은 제시에서도 틀림도 early도 아니다', () => {
    const base = shown();
    const play = stepSight(base, { type: 'hit', id: 9, pad: null, at: 1300, seed: 1 });
    expect(play.step).toBe('shown');
    expect(play.wrongs).toBe(0);
    expect(play.notice).toBeNull();
    expect(play.seen).toContain(9);
    // 같은 id가 나중에 패드와 함께 다시 와도 무시한다
    expect(stepSight(play, { type: 'hit', id: 9, pad: 'KICK', at: 1400, seed: 1 })).toBe(play);
  });

  it('같은 타격 id가 두 번 들어와도 한 번만 센다', () => {
    const wrong = stepSight(shown(), { type: 'hit', id: 77, pad: 'KICK', at: 1300, seed: 1 });
    const again = stepSight(wrong, { type: 'hit', id: 77, pad: 'KICK', at: 1300, seed: 1 });
    expect(again).toBe(wrong);
    expect(again.wrongs).toBe(1);
  });

  it('확인 중의 타격은 같은 객체를 돌려준다', () => {
    const hold = run(shown(), hit('SNARE', 1300));
    expect(stepSight(hold, hit('KICK', 1400))).toBe(hold);
  });
});

describe('timeout', () => {
  it('제시 중이면 5000 ms 시간 초과 답을 쌓고 확인으로 간다', () => {
    const wrong = stepSight(shown(), hit('KICK', 1300));
    const play = stepSight(wrong, { type: 'timeout' });
    expect(play.answers).toEqual([{ pad: 'SNARE', ms: 5000, wrongs: 1, timedOut: true }]);
    expect(play.step).toBe('hold');
  });

  it('대기·확인에서는 그대로', () => {
    const wait = startSight(PROBLEMS);
    expect(stepSight(wait, { type: 'timeout' })).toBe(wait);
    const hold = run(shown(), hit('SNARE', 1300));
    expect(stepSight(hold, { type: 'timeout' })).toBe(hold);
  });
});

describe('next', () => {
  it('확인에서 다음 문제의 대기로', () => {
    const hold = run(shown(), hit('KICK', 1300), hit('SNARE', 1500));
    expect(hold.step).toBe('hold');
    const play = stepSight(hold, { type: 'next' });
    expect(play.step).toBe('wait');
    expect(play.wrongs).toBe(0);
    expect(play.shownAt).toBeNull();
    expect(play.waitSeq).toBe(hold.waitSeq + 1);
    expect(play.notice).toBeNull();
  });

  it('대기·제시에서는 그대로', () => {
    const wait = startSight(PROBLEMS);
    expect(stepSight(wait, { type: 'next' })).toBe(wait);
    const s = shown();
    expect(stepSight(s, { type: 'next' })).toBe(s);
  });

  it('마지막 문제 뒤에는 그대로', () => {
    const play = run(shown(['SNARE']), hit('SNARE', 1300));
    expect(sightFinished(play)).toBe(true);
    expect(stepSight(play, { type: 'next' })).toBe(play);
  });
});

describe('clearNotice', () => {
  it('순번이 맞으면 지우고, 낡은 순번이면 둔다', () => {
    const play = stepSight(shown(), hit('KICK', 1300));
    expect(stepSight(play, { type: 'clearNotice', seq: 1 }).notice).toBeNull();
    const second = stepSight(play, hit('HIHAT', 1400));
    expect(stepSight(second, { type: 'clearNotice', seq: 1 })).toBe(second);
    expect(second.notice).toEqual({ kind: 'wrong', seq: 2 });
  });
});

describe('한 판 전체', () => {
  it('10문제를 차례로 맞히면 끝나고, 끝난 뒤에는 아무 사건도 상태를 바꾸지 않는다', () => {
    let play = startSight(PROBLEMS);
    let t = 1000;
    for (let i = 0; i < PROBLEMS.length; i += 1) {
      play = run(play, { type: 'show' }, { type: 'painted', at: t }, hit(PROBLEMS[i], t + 300 + i));
      expect(play.step).toBe('hold');
      play = stepSight(play, { type: 'next' });
      t += 3000;
    }
    expect(sightFinished(play)).toBe(true);
    expect(play.answers.map((a) => a.pad)).toEqual(PROBLEMS);
    expect(play.answers.map((a) => a.ms)).toEqual(PROBLEMS.map((_, i) => 300 + i));
    expect(currentPad(play)).toBeNull();
    expect(stepSight(play, { type: 'show' })).toBe(play);
    expect(stepSight(play, hit('SNARE', t + 1000))).toBe(play);
    expect(stepSight(play, { type: 'next' })).toBe(play);
  });
});
