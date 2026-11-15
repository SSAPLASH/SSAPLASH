import { describe, expect, it } from 'vitest';
import type { PlayLog } from './playLog';
import { bestAccuracyByChart, bestAccuracyBySong, bestRecordDelta, bestScoreByChart, bestScoreBySong, isSlowedLog, localPrevBest, mergePrevBest, prevBestFor, recordBadgeOf } from './bestRecord';

/** 필요한 필드만 채운 로그 */
function log(p: {
  mode?: PlayLog['mode'];
  song?: number | null;
  chart?: number | null;
  score?: number;
  accuracy?: number;
}): PlayLog {
  return {
    mode: p.mode ?? 'RHYTHM',
    songNumericId: p.song === undefined ? null : p.song,
    chartId: p.chart === undefined ? null : p.chart,
    summary: { score: p.score ?? 0, accuracy: p.accuracy ?? 0 },
  } as unknown as PlayLog;
}

describe('bestScoreBySong', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestScoreBySong([], 'RHYTHM').size).toBe(0);
  });

  it('곡별 최고 점수를 뽑는다', () => {
    const m = bestScoreBySong(
      [log({ song: 1, score: 100 }), log({ song: 1, score: 300 }), log({ song: 2, score: 50 }), log({ song: 1, score: 200 })],
      'RHYTHM',
    );
    expect(m.get(1)).toBe(300);
    expect(m.get(2)).toBe(50);
  });

  it('같은 곡의 여러 연습 단계(채보) 중 가장 높은 점수', () => {
    const m = bestScoreBySong(
      [log({ song: 1, chart: 10, score: 120 }), log({ song: 1, chart: 11, score: 900 }), log({ song: 1, chart: 12, score: 400 })],
      'RHYTHM',
    );
    expect(m.get(1)).toBe(900);
  });

  it('모드별로 분리한다(RHYTHM·SHEET)', () => {
    const logs = [log({ mode: 'RHYTHM', song: 1, score: 100 }), log({ mode: 'SHEET', song: 1, score: 999 })];
    expect(bestScoreBySong(logs, 'RHYTHM').get(1)).toBe(100);
    expect(bestScoreBySong(logs, 'SHEET').get(1)).toBe(999);
    expect(bestScoreBySong(logs, 'FREE').size).toBe(0);
  });

  it('곡 id 없는 로그(내장 채보)는 건너뛴다', () => {
    const m = bestScoreBySong([log({ song: null, score: 500 }), log({ song: 3, score: 10 })], 'RHYTHM');
    expect([...m.keys()]).toEqual([3]);
  });

  it('유한하지 않은 점수는 건너뛴다', () => {
    const m = bestScoreBySong([log({ song: 1, score: Number.NaN }), log({ song: 1, score: 5 })], 'RHYTHM');
    expect(m.get(1)).toBe(5);
  });

  it('0점도 기록으로 센다', () => {
    expect(bestScoreBySong([log({ song: 1, score: 0 })], 'RHYTHM').get(1)).toBe(0);
  });
});

describe('bestAccuracyByChart', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestAccuracyByChart([], 'RHYTHM').size).toBe(0);
  });

  it('채보별 최고 정확도를 뽑는다', () => {
    const m = bestAccuracyByChart(
      [log({ chart: 10, accuracy: 0.5 }), log({ chart: 10, accuracy: 0.9 }), log({ chart: 11, accuracy: 0.7 }), log({ chart: 10, accuracy: 0.8 })],
      'RHYTHM',
    );
    expect(m.get(10)).toBe(0.9);
    expect(m.get(11)).toBe(0.7);
  });

  it('모드별로 분리한다(RHYTHM·SHEET)', () => {
    const logs = [log({ mode: 'RHYTHM', chart: 10, accuracy: 0.4 }), log({ mode: 'SHEET', chart: 10, accuracy: 0.95 })];
    expect(bestAccuracyByChart(logs, 'RHYTHM').get(10)).toBe(0.4);
    expect(bestAccuracyByChart(logs, 'SHEET').get(10)).toBe(0.95);
  });

  it('채보 id 없는 로그는 건너뛴다', () => {
    const m = bestAccuracyByChart([log({ chart: null, accuracy: 1 }), log({ chart: 2, accuracy: 0.3 })], 'RHYTHM');
    expect([...m.keys()]).toEqual([2]);
  });

  it('유한하지 않은 정확도는 건너뛴다', () => {
    const m = bestAccuracyByChart([log({ chart: 1, accuracy: Number.NaN }), log({ chart: 1, accuracy: 0.2 })], 'RHYTHM');
    expect(m.get(1)).toBe(0.2);
  });
});

describe('bestScoreByChart', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestScoreByChart([], 'RHYTHM').size).toBe(0);
  });

  it('채보별 최고 점수를 뽑는다', () => {
    const m = bestScoreByChart(
      [log({ chart: 10, score: 500 }), log({ chart: 10, score: 900 }), log({ chart: 11, score: 700 }), log({ chart: 10, score: 800 })],
      'RHYTHM',
    );
    expect(m.get(10)).toBe(900);
    expect(m.get(11)).toBe(700);
  });

  it('모드별로 분리한다(RHYTHM·SHEET)', () => {
    const logs = [log({ mode: 'RHYTHM', chart: 10, score: 400 }), log({ mode: 'SHEET', chart: 10, score: 950 })];
    expect(bestScoreByChart(logs, 'RHYTHM').get(10)).toBe(400);
    expect(bestScoreByChart(logs, 'SHEET').get(10)).toBe(950);
  });

  it('채보 id 없는 로그와 유한하지 않은 점수는 건너뛴다', () => {
    const m = bestScoreByChart([log({ chart: null, score: 1000 }), log({ chart: 2, score: Number.NaN }), log({ chart: 2, score: 300 })], 'RHYTHM');
    expect([...m]).toEqual([[2, 300]]);
  });
});

describe('bestAccuracyBySong', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestAccuracyBySong([], 'SHEET').size).toBe(0);
  });

  it('같은 곡의 여러 연습 단계 중 가장 높은 정확도가 곡 최고', () => {
    const m = bestAccuracyBySong(
      [
        log({ mode: 'SHEET', song: 1, chart: 10, accuracy: 0.6 }),
        log({ mode: 'SHEET', song: 1, chart: 11, accuracy: 0.92 }),
        log({ mode: 'SHEET', song: 1, chart: 12, accuracy: 0.8 }),
        log({ mode: 'SHEET', song: 2, chart: 20, accuracy: 0.3 }),
      ],
      'SHEET',
    );
    expect(m.get(1)).toBe(0.92);
    expect(m.get(2)).toBe(0.3);
  });

  it('SHEET·RHYTHM을 분리한다', () => {
    const logs = [log({ mode: 'RHYTHM', song: 1, accuracy: 0.5 }), log({ mode: 'SHEET', song: 1, accuracy: 0.97 })];
    expect(bestAccuracyBySong(logs, 'RHYTHM').get(1)).toBe(0.5);
    expect(bestAccuracyBySong(logs, 'SHEET').get(1)).toBe(0.97);
  });

  it('곡 id 없는 로그는 건너뛴다', () => {
    const m = bestAccuracyBySong([log({ mode: 'SHEET', song: null, accuracy: 1 }), log({ mode: 'SHEET', song: 4, accuracy: 0.1 })], 'SHEET');
    expect([...m.keys()]).toEqual([4]);
  });

  it('유한하지 않은 정확도는 건너뛰고 0도 기록으로 센다', () => {
    const m = bestAccuracyBySong([log({ mode: 'SHEET', song: 1, accuracy: Number.NaN }), log({ mode: 'SHEET', song: 2, accuracy: 0 })], 'SHEET');
    expect(m.has(1)).toBe(false);
    expect(m.get(2)).toBe(0);
  });
});

describe('bestRecordDelta', () => {
  const g = (score: number) => ({ mode: 'RHYTHM' as const, summary: { score, accuracy: 0.5 } }) as unknown as PlayLog;
  const s = (accuracy: number) => ({ mode: 'SHEET' as const, summary: { score: 0, accuracy } }) as unknown as PlayLog;

  it('게임: 이전 점수가 없으면 first', () => {
    expect(bestRecordDelta(g(100), { score: null, accuracy: null }).kind).toBe('first');
  });
  it('게임: 이전보다 높으면 new, 같거나 낮으면 same', () => {
    expect(bestRecordDelta(g(101), { score: 100, accuracy: null })).toEqual({ kind: 'new', prevScore: 100, prevAccuracy: null });
    expect(bestRecordDelta(g(100), { score: 100, accuracy: null }).kind).toBe('same');
    expect(bestRecordDelta(g(99), { score: 100, accuracy: null }).kind).toBe('same');
  });
  it('악보: 정확도를 소수 3자리로 비교한다', () => {
    expect(bestRecordDelta(s(0.9), { score: null, accuracy: null }).kind).toBe('first');
    expect(bestRecordDelta(s(0.9501), { score: null, accuracy: 0.95 }).kind).toBe('same'); // 3자리 반올림이 같다
    expect(bestRecordDelta(s(0.952), { score: null, accuracy: 0.95 }).kind).toBe('new');
    expect(bestRecordDelta(s(0.9), { score: null, accuracy: 0.95 }).kind).toBe('same');
  });
  it('악보는 점수 기록이 있어도 정확도만 본다', () => {
    expect(bestRecordDelta(s(0.8), { score: 5000, accuracy: null }).kind).toBe('first');
  });
});

describe('localPrevBest·mergePrevBest', () => {
  const full = (p: { mode?: PlayLog['mode']; song?: number | null; chart?: number | null; songId?: string; difficulty?: string; score?: number; accuracy?: number; playId?: string }) =>
    ({ ...log(p), playId: p.playId ?? 'x', songId: p.songId ?? 's', difficulty: p.difficulty ?? 'NORMAL' }) as PlayLog;

  it('게임 점수는 곡 id 기준 최고(이 판 제외)', () => {
    const logs = [full({ song: 1, chart: 10, score: 100, playId: 'a' }), full({ song: 1, chart: 11, score: 300, playId: 'b' }), full({ song: 1, chart: 10, score: 999, playId: 'me' })];
    const prev = localPrevBest(logs, { mode: 'RHYTHM', songNumericId: 1, chartId: 10, songId: 's', difficulty: 'NORMAL' }, (l) => l.playId === 'me');
    expect(prev.score).toBe(300);
    expect(prev.accuracy).toBe(0);
  });
  it('기록이 없으면 null', () => {
    expect(localPrevBest([], { mode: 'RHYTHM', songNumericId: 1, chartId: 10, songId: 's', difficulty: 'NORMAL' })).toEqual({ score: null, accuracy: null });
  });
  it('악보 정확도는 채보 id 기준', () => {
    const logs = [full({ mode: 'SHEET', song: 1, chart: 10, accuracy: 0.8 }), full({ mode: 'SHEET', song: 1, chart: 11, accuracy: 0.99 })];
    expect(localPrevBest(logs, { mode: 'SHEET', songNumericId: 1, chartId: 10, songId: 's', difficulty: 'NORMAL' }).accuracy).toBe(0.8);
  });
  it('내장 곡(id 없음)은 곡 id·단계로 맞춘다', () => {
    const logs = [full({ songId: 'b1', difficulty: 'HARD', score: 70 }), full({ songId: 'b1', difficulty: 'EASY', score: 900 })];
    expect(localPrevBest(logs, { mode: 'RHYTHM', songNumericId: null, chartId: null, songId: 'b1', difficulty: 'HARD' }).score).toBe(70);
  });
  describe('GOOD 폭이 같은 기록끼리만 비교', () => {
    const withTiming = (goodMs: number | undefined, p: Parameters<typeof full>[0]) => ({ ...full(p), ...(goodMs === undefined ? {} : { timing: { perfectMs: 25, goodMs } }) }) as PlayLog;
    const target = { mode: 'RHYTHM' as const, songNumericId: 1, chartId: 10, songId: 's', difficulty: 'EASY' };
    const logs = [withTiming(60, { song: 1, chart: 10, score: 900, playId: 'a' }), withTiming(90, { song: 1, chart: 10, score: 700, playId: 'b' }), withTiming(undefined, { song: 1, chart: 10, score: 950, playId: 'old' })];
    it('goodMs를 주면 같은 폭의 로그만 대상이다(timing 없는 옛 로그는 뺀다)', () => {
      expect(localPrevBest(logs, { ...target, goodMs: 90 }).score).toBe(700);
      expect(localPrevBest(logs, { ...target, goodMs: 60 }).score).toBe(900);
    });
    it('같은 폭의 기록이 없으면 null이라 첫 기록이 된다', () => {
      const prev = localPrevBest(logs, { ...target, goodMs: 120 });
      expect(prev).toEqual({ score: null, accuracy: null });
      expect(bestRecordDelta(log({ score: 10 }), prev).kind).toBe('first');
    });
    it('goodMs 없이 부르면 폭을 따지지 않는다', () => {
      expect(localPrevBest(logs, target).score).toBe(950);
    });
    it('악보 정확도도 같은 폭끼리만 비교한다', () => {
      const sheet = [withTiming(60, { mode: 'SHEET', song: 1, chart: 10, accuracy: 0.95 }), withTiming(90, { mode: 'SHEET', song: 1, chart: 10, accuracy: 0.8 })];
      expect(localPrevBest(sheet, { ...target, mode: 'SHEET', goodMs: 90 }).accuracy).toBe(0.8);
    });
  });
  it('prevBestFor는 기본 폭에서만 서버 값을 합친다', () => {
    const local = { score: 100, accuracy: null };
    const server = { score: 500, accuracy: 0.9 };
    expect(prevBestFor(local, server, 60)).toEqual({ score: 500, accuracy: 0.9 });
    expect(prevBestFor(local, server, 90)).toBe(local);
  });
  it('mergePrevBest는 큰 값, 둘 다 없으면 null', () => {
    expect(mergePrevBest({ score: 10, accuracy: null }, { score: 20, accuracy: 0.5 })).toEqual({ score: 20, accuracy: 0.5 });
    expect(mergePrevBest({ score: null, accuracy: null }, { score: null, accuracy: null })).toEqual({ score: null, accuracy: null });
  });
});

describe('recordBadgeOf', () => {
  const lg = (mode: PlayLog['mode'], score: number, accuracy: number) => ({ mode, summary: { score, accuracy } }) as unknown as PlayLog;
  it('same은 칩 없음, first는 첫 기록', () => {
    expect(recordBadgeOf(lg('RHYTHM', 1, 1), { kind: 'same', prevScore: 5, prevAccuracy: null })).toBeNull();
    expect(recordBadgeOf(lg('RHYTHM', 1, 1), { kind: 'first', prevScore: null, prevAccuracy: null })).toEqual({ kind: 'first', text: '첫 기록' });
  });
  it('게임 갱신 문구는 이전 → 현재 점수', () => {
    const b = recordBadgeOf(lg('RHYTHM', 1310000, 0.9), { kind: 'new', prevScore: 1200000, prevAccuracy: null });
    expect(b).toEqual({ kind: 'new', text: '최고 기록 갱신 · 이전 1,200,000 → 현재 1,310,000' });
  });
  it('악보 갱신 문구는 정확도 %', () => {
    const b = recordBadgeOf(lg('SHEET', 0, 0.968), { kind: 'new', prevScore: null, prevAccuracy: 0.9 });
    expect(b?.text).toBe('최고 기록 갱신 · 이전 90.0% → 현재 96.8%');
  });
});

describe('연습 속도로 친 판은 최고 기록에 세지 않는다 (MODE-003)', () => {
  const slow = (p: Parameters<typeof log>[0], rate: number) => ({ ...log(p), playbackRate: rate }) as PlayLog;

  it('배율이 없거나 1이면 원래 빠르기다', () => {
    expect(isSlowedLog({})).toBe(false);
    expect(isSlowedLog({ playbackRate: 1 })).toBe(false);
    expect(isSlowedLog({ playbackRate: 0.7 })).toBe(true);
  });

  it('곡별·채보별 최고 점수와 정확도에서 빠진다', () => {
    const logs = [log({ song: 1, chart: 10, score: 100, accuracy: 0.5 }), slow({ song: 1, chart: 10, score: 300, accuracy: 0.99 }, 0.7)];
    expect(bestScoreBySong(logs, 'RHYTHM').get(1)).toBe(100);
    expect(bestScoreByChart(logs, 'RHYTHM').get(10)).toBe(100);
    expect(bestAccuracyByChart(logs, 'RHYTHM').get(10)).toBe(0.5);
    expect(bestAccuracyBySong(logs, 'RHYTHM').get(1)).toBe(0.5);
  });

  it('느린 판만 있으면 기록이 없다', () => {
    const logs = [slow({ mode: 'SHEET', song: 1, chart: 10, accuracy: 0.9 }, 0.5)];
    expect(bestAccuracyByChart(logs, 'SHEET').size).toBe(0);
    expect(localPrevBest(logs, { mode: 'SHEET', songNumericId: 1, chartId: 10, songId: 's', difficulty: 'EASY' })).toEqual({ score: null, accuracy: null });
  });
});

