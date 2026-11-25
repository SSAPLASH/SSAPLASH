import { describe, expect, it } from 'vitest';
import {
  BACKING_LEAD_MS,
  CHART_CLAMP_MS,
  chartOffsetMs,
  formatSigned,
  isOneShotDetail,
  isOneShotRecord,
  judgeShot,
  LATE_LIMIT_MS,
  ONE_SHOT_CLOSING_MS,
  recordText,
  shotCaption,
  shotOffsetMs,
  shotScore,
  shotStageText,
  shotTitle,
  SHOT_TOLERANCE_MS,
  sideWord,
  whenLabel,
  type ShotOutcome,
} from './oneShotRound';

const success = (errorMs: number): ShotOutcome => ({ kind: 'success', errorMs });
const miss = (errorMs: number): ShotOutcome => ({ kind: 'miss', errorMs });
const BEFORE: ShotOutcome = { kind: 'before' };
const NONE: ShotOutcome = { kind: 'none' };

describe('상수', () => {
  it('설계 값과 같다', () => {
    expect(SHOT_TOLERANCE_MS).toBe(80);
    expect(LATE_LIMIT_MS).toBe(1000);
    expect(BACKING_LEAD_MS).toBe(400);
    expect(ONE_SHOT_CLOSING_MS).toBe(1500);
    expect(CHART_CLAMP_MS).toBe(250);
  });
});

describe('shotOffsetMs', () => {
  it('스틱 타격이면 스틱 값(킥 값은 무시)', () => {
    expect(shotOffsetMs(false, 12, 30)).toBe(12);
    expect(shotOffsetMs(false, 12, null)).toBe(12);
  });

  it('발 타격이면 킥 값', () => {
    expect(shotOffsetMs(true, 12, 30)).toBe(30);
  });

  it('발 타격인데 킥 값이 없으면 스틱 값', () => {
    expect(shotOffsetMs(true, 12, null)).toBe(12);
  });

  it('음수도 그대로 넘긴다', () => {
    expect(shotOffsetMs(false, -15, null)).toBe(-15);
    expect(shotOffsetMs(true, 12, -40)).toBe(-40);
  });
});

describe('judgeShot', () => {
  const rest = 1000;
  const answer = 3500;

  it('정적 시작보다 1ms 이르면 before이고 errorMs가 없다', () => {
    const outcome = judgeShot(rest - 1, rest, answer);
    expect(outcome).toEqual({ kind: 'before' });
    expect('errorMs' in outcome).toBe(false);
  });

  it('정적 시작 시각 정각이면 before가 아니다(정답과 멀면 miss)', () => {
    const outcome = judgeShot(rest, rest, answer);
    expect(outcome.kind).toBe('miss');
    expect(outcome).toEqual({ kind: 'miss', errorMs: rest - answer });
  });

  it('정답 정각이면 success, 오차 0', () => {
    expect(judgeShot(answer, rest, answer)).toEqual({ kind: 'success', errorMs: 0 });
  });

  it('+80은 success, +81은 miss', () => {
    expect(judgeShot(answer + 80, rest, answer)).toEqual({ kind: 'success', errorMs: 80 });
    expect(judgeShot(answer + 81, rest, answer)).toEqual({ kind: 'miss', errorMs: 81 });
  });

  it('−80은 success, −81은 miss', () => {
    expect(judgeShot(answer - 80, rest, answer)).toEqual({ kind: 'success', errorMs: -80 });
    expect(judgeShot(answer - 81, rest, answer)).toEqual({ kind: 'miss', errorMs: -81 });
  });

  it('소수 시각은 반올림해 판정한다', () => {
    expect(judgeShot(answer + 79.6, rest, answer)).toEqual({ kind: 'success', errorMs: 80 });
    expect(judgeShot(answer + 80.4, rest, answer)).toEqual({ kind: 'success', errorMs: 80 });
    expect(judgeShot(answer + 80.6, rest, answer)).toEqual({ kind: 'miss', errorMs: 81 });
  });

  it('정답에서 한참 뒤에 치면 양수 오차의 miss', () => {
    expect(judgeShot(answer + 900, rest, answer)).toEqual({ kind: 'miss', errorMs: 900 });
  });
});

describe('shotScore', () => {
  it('success는 오차의 절댓값', () => {
    expect(shotScore(success(-38))).toBe(38);
    expect(shotScore(success(38))).toBe(38);
    expect(shotScore(success(0))).toBe(0);
  });

  it('miss·before·none은 null', () => {
    expect(shotScore(miss(142))).toBeNull();
    expect(shotScore(BEFORE)).toBeNull();
    expect(shotScore(NONE)).toBeNull();
  });
});

describe('formatSigned', () => {
  it('양수는 +, 음수는 U+2212 마이너스, 0은 부호 없음', () => {
    expect(formatSigned(38)).toBe('+38');
    expect(formatSigned(-61)).toBe('−61');
    expect(formatSigned(0)).toBe('0');
  });
});

describe('sideWord', () => {
  it('음수는 빠름, 양수는 늦음, 0은 정박', () => {
    expect(sideWord(-1)).toBe('빠름');
    expect(sideWord(1)).toBe('늦음');
    expect(sideWord(0)).toBe('정박');
  });
});

describe('shotCaption', () => {
  it('success는 허용 범위 안', () => {
    expect(shotCaption(success(38))).toBe('늦음 · 허용 범위 80ms 안');
    expect(shotCaption(success(-12))).toBe('빠름 · 허용 범위 80ms 안');
    expect(shotCaption(success(0))).toBe('정박 · 허용 범위 80ms 안');
  });

  it('miss는 허용 범위 밖', () => {
    expect(shotCaption(miss(142))).toBe('늦음 · 허용 범위 80ms 밖');
  });

  it('before·none은 잰 값이 없다', () => {
    expect(shotCaption(BEFORE)).toBe('잰 값이 없어요');
    expect(shotCaption(NONE)).toBe('잰 값이 없어요');
  });
});

describe('shotTitle', () => {
  it('success', () => {
    expect(shotTitle(success(38))).toEqual(['38ms 늦었어요.', '노래가 돌아왔어요.']);
    expect(shotTitle(success(-61))).toEqual(['61ms 빨랐어요.', '노래가 돌아왔어요.']);
    expect(shotTitle(success(0))).toEqual(['정확히 맞았어요.', '노래가 돌아왔어요.']);
  });

  it('miss', () => {
    expect(shotTitle(miss(142))).toEqual(['142ms 늦었어요.', '80ms 안에 쳐야 노래가 돌아와요.']);
  });

  it('before', () => {
    expect(shotTitle(BEFORE)).toEqual(['정적 전에 쳤어요.', '노래가 끊긴 뒤에 한 번만 치세요.']);
  });

  it('none', () => {
    expect(shotTitle(NONE)).toEqual(['치지 않았어요.', '노래가 돌아올 자리에 한 번 치세요.']);
  });
});

describe('shotStageText', () => {
  it('success·miss는 부호 있는 값과 빠름·늦음·성공·실패', () => {
    expect(shotStageText(success(38))).toEqual({ value: '+38 ms', caption: '늦음 · 성공' });
    expect(shotStageText(miss(-142))).toEqual({ value: '−142 ms', caption: '빠름 · 실패' });
    expect(shotStageText(success(0))).toEqual({ value: '0 ms', caption: '정박 · 성공' });
  });

  it('before·none은 큰 글만', () => {
    expect(shotStageText(BEFORE)).toEqual({ value: '정적 전에 쳤어요', caption: '' });
    expect(shotStageText(NONE)).toEqual({ value: '치지 않았어요', caption: '' });
  });
});

describe('recordText', () => {
  it('절댓값과 빠름·늦음·정박', () => {
    expect(recordText(38)).toBe('38ms 늦음');
    expect(recordText(-7)).toBe('7ms 빠름');
    expect(recordText(0)).toBe('0ms 정박');
  });
});

describe('whenLabel', () => {
  const now = new Date(2026, 10, 10, 12, 0);
  const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString();

  it('이번 판 기록이면 날짜와 상관없이 방금', () => {
    expect(whenLabel(at(2026, 0, 1), now, true)).toBe('방금');
    expect(whenLabel(at(2026, 10, 10), now, true)).toBe('방금');
  });

  it('같은 날이면 오늘', () => {
    expect(whenLabel(at(2026, 10, 10, 0, 1), now, false)).toBe('오늘');
    expect(whenLabel(at(2026, 10, 10, 11, 59), now, false)).toBe('오늘');
  });

  it('어제는 몇 분 차이여도 날짜가 다르면 어제', () => {
    const justAfterMidnight = new Date(2026, 10, 10, 0, 5);
    expect(whenLabel(at(2026, 10, 9, 23, 55), justAfterMidnight, false)).toBe('어제');
    expect(whenLabel(at(2026, 10, 9, 8, 0), now, false)).toBe('어제');
  });

  it('2일~6일 전은 N일 전', () => {
    expect(whenLabel(at(2026, 10, 8), now, false)).toBe('2일 전');
    expect(whenLabel(at(2026, 10, 4), now, false)).toBe('6일 전');
  });

  it('7일 전부터는 월 일', () => {
    expect(whenLabel(at(2026, 10, 3), now, false)).toBe('11월 3일');
  });

  it('미래 시각은 오늘', () => {
    expect(whenLabel(at(2026, 10, 15), now, false)).toBe('오늘');
  });

  it('시각을 읽을 수 없으면 빈 글', () => {
    expect(whenLabel('not-a-date', now, false)).toBe('');
  });
});

describe('chartOffsetMs', () => {
  it('±250 안으로 자른다', () => {
    expect(chartOffsetMs(38)).toBe(38);
    expect(chartOffsetMs(300)).toBe(250);
    expect(chartOffsetMs(-300)).toBe(-250);
    expect(chartOffsetMs(250)).toBe(250);
  });
});

describe('isOneShotDetail', () => {
  it('정수이고 절댓값이 80 이하면 참', () => {
    expect(isOneShotDetail({ errorMs: 38 })).toBe(true);
    expect(isOneShotDetail({ errorMs: -80 })).toBe(true);
    expect(isOneShotDetail({ errorMs: 80 })).toBe(true);
    expect(isOneShotDetail({ errorMs: 0 })).toBe(true);
  });

  it('범위 밖·소수·문자열·없음·null은 거짓', () => {
    expect(isOneShotDetail({ errorMs: 81 })).toBe(false);
    expect(isOneShotDetail({ errorMs: -81 })).toBe(false);
    expect(isOneShotDetail({ errorMs: 3.5 })).toBe(false);
    expect(isOneShotDetail({ errorMs: '38' })).toBe(false);
    expect(isOneShotDetail({})).toBe(false);
    expect(isOneShotDetail(null)).toBe(false);
  });
});

describe('isOneShotRecord', () => {
  it('곡 표에 있는 곡이고 점수가 오차의 절댓값이면 참', () => {
    expect(isOneShotRecord('iwaly', 38, { errorMs: -38 })).toBe(true);
    expect(isOneShotRecord('iwaly', 38, { errorMs: 38 })).toBe(true);
  });

  it('점수가 다르면 거짓', () => {
    expect(isOneShotRecord('iwaly', 37, { errorMs: -38 })).toBe(false);
  });

  it('모르는 곡이거나 갈래가 없으면 거짓', () => {
    expect(isOneShotRecord('nope', 38, { errorMs: -38 })).toBe(false);
    expect(isOneShotRecord(undefined, 38, { errorMs: -38 })).toBe(false);
  });
});
