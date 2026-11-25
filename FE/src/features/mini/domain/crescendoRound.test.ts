import { describe, expect, it } from 'vitest';
import {
  averageStep,
  bestNote,
  buildRun,
  CLIMB_PROMPT_TAIL,
  collectRun,
  CRESCENDO_CLOSING_MS,
  CRESCENDO_MIN_STEP,
  isCrescendoDetail,
  isCrescendoRecord,
  nextFloor,
  runHint,
  runPrompt,
  runRemark,
  runScore,
  STRONG_START,
} from './crescendoRound';

const START = 5000;

/** 타격. 타격 시각과 받은 시각이 같고 센서 소스인 스네어가 기본이다 */
function hit(t: number, velocity = 64, over: { pad?: string | null; source?: string | undefined; tRecv?: number; tHit?: number } = {}) {
  const base = { pad: 'SNARE', source: 'serial', tHit: t, tRecv: t, velocity };
  return { ...base, ...over } as unknown as Parameters<typeof collectRun>[1][number];
}

describe('상수', () => {
  it('값이 설계와 같다', () => {
    expect(CRESCENDO_MIN_STEP).toBe(1);
    expect(CRESCENDO_CLOSING_MS).toBe(1500);
    expect(STRONG_START).toBe(64);
  });
});

describe('buildRun', () => {
  it('세기가 없으면 진행 중이고 계단이 없다', () => {
    expect(buildRun([])).toEqual({ steps: [], end: null, last: null });
  });

  it('첫 타는 어떤 세기든 계단이 된다(1도, 126도)', () => {
    expect(buildRun([1])).toEqual({ steps: [1], end: null, last: null });
    expect(buildRun([126])).toEqual({ steps: [126], end: null, last: null });
  });

  it('직전보다 1 세면 이어진다(30·31·32)', () => {
    expect(buildRun([30, 31, 32])).toEqual({ steps: [30, 31, 32], end: null, last: null });
  });

  it('직전과 같으면 fell로 끝나고 last에 그 세기가 있다(30·42·42)', () => {
    expect(buildRun([30, 42, 42])).toEqual({ steps: [30, 42], end: 'fell', last: 42 });
  });

  it('직전보다 약하면 fell로 끝난다(30·42·55·49)', () => {
    expect(buildRun([30, 42, 55, 49])).toEqual({ steps: [30, 42, 55], end: 'fell', last: 49 });
  });

  it('127이면 top으로 끝나고 그 타격까지 계단이며 last는 null이다(100·127)', () => {
    expect(buildRun([100, 127])).toEqual({ steps: [100, 127], end: 'top', last: null });
  });

  it('첫 타가 127이면 계단 1개로 top이다', () => {
    expect(buildRun([127])).toEqual({ steps: [127], end: 'top', last: null });
  });

  it('끝난 뒤의 세기는 보지 않는다(30·20·90)', () => {
    expect(buildRun([30, 20, 90])).toEqual({ steps: [30], end: 'fell', last: 20 });
  });

  it('top 뒤의 세기도 보지 않는다', () => {
    expect(buildRun([100, 127, 10, 127])).toEqual({ steps: [100, 127], end: 'top', last: null });
  });
});

describe('collectRun', () => {
  it('받을 타격으로 계단을 만든다', () => {
    expect(collectRun(START, [hit(START + 300, 30), hit(START + 700, 42), hit(START + 1200, 55)])).toEqual({
      steps: [30, 42, 55],
      end: null,
      last: null,
    });
  });

  it('플레이 시작보다 이른 타격과 시작 뒤 299ms 안의 타격은 빠진다', () => {
    const run = collectRun(START, [hit(START - 500, 90), hit(START + 299, 91), hit(START + 300, 30)]);
    expect(run.steps).toEqual([30]);
    expect(run.end).toBeNull();
  });

  it('받은 타격 뒤 300ms 안의 약한 타격은 받지 않아 판이 끝나지 않는다', () => {
    const run = collectRun(START, [hit(START + 300, 50), hit(START + 500, 20), hit(START + 599, 10), hit(START + 700, 60)]);
    expect(run).toEqual({ steps: [50, 60], end: null, last: null });
  });

  it('다른 패드·키보드·패드 판정 없는 타격은 판을 끝내지 않는다', () => {
    const run = collectRun(START, [
      hit(START + 400, 50),
      hit(START + 800, 10, { pad: 'HIHAT' }),
      hit(START + 900, 10, { source: 'keyboard' }),
      hit(START + 1000, 10, { pad: null }),
    ]);
    expect(run).toEqual({ steps: [50], end: null, last: null });
  });

  it('300ms가 지난 약한 타격은 판을 끝낸다', () => {
    expect(collectRun(START, [hit(START + 300, 50), hit(START + 600, 40)])).toEqual({ steps: [50], end: 'fell', last: 40 });
  });

  it('타격이 없으면 빈 판이다', () => {
    expect(collectRun(START, [])).toEqual({ steps: [], end: null, last: null });
  });
});

describe('runScore', () => {
  it('계단 수다', () => {
    expect(runScore(buildRun([30, 42, 55]))).toBe(3);
    expect(runScore(buildRun([]))).toBe(0);
  });

  it('끝낸 타격은 세지 않는다(30·42·55·49 → 3)', () => {
    expect(runScore(buildRun([30, 42, 55, 49]))).toBe(3);
  });
});

describe('nextFloor', () => {
  it('진행 중이면 마지막 계단 + 1이다', () => {
    expect(nextFloor(buildRun([30, 42]))).toBe(43);
  });

  it('계단이 없으면 null', () => {
    expect(nextFloor(buildRun([]))).toBeNull();
  });

  it('끝난 판이면 null', () => {
    expect(nextFloor(buildRun([30, 42, 42]))).toBeNull();
    expect(nextFloor(buildRun([100, 127]))).toBeNull();
  });
});

describe('averageStep', () => {
  it('(마지막 − 첫) ÷ (계단 수 − 1)을 소수 첫째 자리로 돌려준다', () => {
    expect(averageStep(buildRun([30, 42, 55]))).toBe(12.5);
    expect(averageStep(buildRun([31, 40, 47, 104]))).toBe(24.3);
  });

  it('계단이 1개 이하면 null', () => {
    expect(averageStep(buildRun([30]))).toBeNull();
    expect(averageStep(buildRun([]))).toBeNull();
  });
});

describe('runPrompt', () => {
  it('첫 타 전에는 약하게 시작하라고 한다', () => {
    expect(runPrompt(buildRun([]))).toEqual({ lead: null, text: '약하게 시작하세요.' });
  });

  it('진행 중이면 마지막 계단 숫자와 「보다 세게.」다', () => {
    expect(runPrompt(buildRun([30, 42]))).toEqual({ lead: 42, text: '보다 세게.' });
    expect(CLIMB_PROMPT_TAIL).toBe('보다 세게.');
  });

  it('fell이면 마지막 계단 숫자와 「보다 세지 못했어요.」다', () => {
    expect(runPrompt(buildRun([30, 42, 42]))).toEqual({ lead: 42, text: '보다 세지 못했어요.' });
  });

  it('top이면 숫자 없이 「꼭대기까지 올랐어요.」다', () => {
    expect(runPrompt(buildRun([100, 127]))).toEqual({ lead: null, text: '꼭대기까지 올랐어요.' });
  });
});

describe('runHint', () => {
  it('첫 타 전 안내', () => {
    expect(runHint(buildRun([]))).toBe('약할수록 오를 계단이 많아요.');
  });

  it('진행 중 안내', () => {
    expect(runHint(buildRun([30]))).toBe('조금만 더 세게 치세요.');
  });

  it('끝난 판은 빈 글', () => {
    expect(runHint(buildRun([30, 20]))).toBe('');
    expect(runHint(buildRun([127]))).toBe('');
  });
});

describe('runRemark', () => {
  it('top이면 꼭대기까지 올랐다고 한다', () => {
    expect(runRemark(buildRun([100, 127]))).toBe('꼭대기까지 올랐어요.');
  });

  it('끝낸 타격이 직전과 같으면 「마지막이 앞과 같았어요.」', () => {
    expect(runRemark(buildRun([30, 42, 42]))).toBe('마지막이 앞과 같았어요.');
  });

  it('끝낸 타격이 직전보다 약하면 얼마나 약했는지 말한다(30·42·55·49 → 6)', () => {
    expect(runRemark(buildRun([30, 42, 55, 49]))).toBe('마지막이 앞보다 6 약했어요.');
  });

  it('첫 타가 63이면 일반 문구, 64면 시작이 셌다고 한다', () => {
    expect(runRemark(buildRun([63, 55]))).toBe('마지막이 앞보다 8 약했어요.');
    expect(runRemark(buildRun([64, 55]))).toBe('시작이 셌어요. 더 약하게 시작해 보세요.');
  });

  it('첫 타가 64 이상이어도 top이면 꼭대기 문구다', () => {
    expect(runRemark(buildRun([64, 127]))).toBe('꼭대기까지 올랐어요.');
    expect(runRemark(buildRun([127]))).toBe('꼭대기까지 올랐어요.');
  });
});

describe('bestNote (높을수록 좋다)', () => {
  it('이전 기록이 없으면 첫 기록', () => {
    expect(bestNote(9, null)).toEqual({ newBest: true, text: '첫 기록이에요' });
  });

  it('이전보다 높으면 새 최고', () => {
    expect(bestNote(9, 7)).toEqual({ newBest: true, text: '지난 최고 7번' });
  });

  it('같으면 새 최고가 아니다', () => {
    expect(bestNote(9, 9)).toEqual({ newBest: false, text: '최고 기록과 같아요' });
  });

  it('이전보다 낮으면 최고 기록을 알려 준다', () => {
    expect(bestNote(9, 12)).toEqual({ newBest: false, text: '최고 기록 12번' });
  });
});

describe('isCrescendoDetail', () => {
  it('맞는 모양은 참', () => {
    expect(isCrescendoDetail({ steps: [30, 42, 55], last: 49 })).toBe(true);
    // 같아서 끝남
    expect(isCrescendoDetail({ steps: [30, 42], last: 42 })).toBe(true);
    // 꼭대기에 닿아 끝남
    expect(isCrescendoDetail({ steps: [100, 127], last: null })).toBe(true);
    expect(isCrescendoDetail({ steps: [127], last: null })).toBe(true);
  });

  it('계단이 비어 있으면 거짓', () => {
    expect(isCrescendoDetail({ steps: [], last: null })).toBe(false);
  });

  it('계단이 커지지 않으면 거짓', () => {
    expect(isCrescendoDetail({ steps: [30, 30], last: 30 })).toBe(false);
    expect(isCrescendoDetail({ steps: [42, 30], last: 30 })).toBe(false);
  });

  it('계단 값이 정수가 아니거나 0·128이면 거짓', () => {
    expect(isCrescendoDetail({ steps: [30, 42.5], last: 42 })).toBe(false);
    expect(isCrescendoDetail({ steps: [0, 42], last: 42 })).toBe(false);
    expect(isCrescendoDetail({ steps: [30, 128], last: null })).toBe(false);
  });

  it('last가 마지막 계단보다 크면 거짓', () => {
    expect(isCrescendoDetail({ steps: [30, 42], last: 43 })).toBe(false);
  });

  it('last가 null인데 마지막 계단이 127이 아니면 거짓', () => {
    expect(isCrescendoDetail({ steps: [30, 42], last: null })).toBe(false);
  });

  it('last가 범위 밖이거나 문자열이면 거짓', () => {
    expect(isCrescendoDetail({ steps: [30, 42], last: 0 })).toBe(false);
    expect(isCrescendoDetail({ steps: [30, 42], last: 128 })).toBe(false);
    expect(isCrescendoDetail({ steps: [30, 42], last: '42' })).toBe(false);
  });

  it('steps가 배열이 아니면 거짓', () => {
    expect(isCrescendoDetail({ steps: '30,42', last: 42 })).toBe(false);
    expect(isCrescendoDetail({ last: 42 })).toBe(false);
  });

  it('null·문자열·배열은 거짓', () => {
    expect(isCrescendoDetail(null)).toBe(false);
    expect(isCrescendoDetail('x')).toBe(false);
    expect(isCrescendoDetail([])).toBe(false);
  });
});

describe('isCrescendoRecord', () => {
  it('점수가 계단 수와 같으면 참', () => {
    expect(isCrescendoRecord(3, { steps: [30, 42, 55], last: 49 })).toBe(true);
  });

  it('점수가 계단 수와 다르면 거짓', () => {
    expect(isCrescendoRecord(5, { steps: [30, 42, 55], last: 49 })).toBe(false);
    expect(isCrescendoRecord(2, { steps: [30, 42, 55], last: 49 })).toBe(false);
  });
});
