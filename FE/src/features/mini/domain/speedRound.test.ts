import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import {
  acceptedOffsets,
  acceptsHit,
  currentRate,
  hitsPerSecond,
  isSpeedDetail,
  parseSpeedSeconds,
  peakSecond,
  secondBuckets,
  SPEED_VARIANTS,
  speedDurationMs,
  speedHeat,
  speedResultTitle,
  speedVariant,
  speedVerdict,
} from './speedRound';

const START = 5000;
/** 10초 판의 제한 시간(ms) */
const TEN = 10_000;
/** 5초 판의 제한 시간(ms) */
const FIVE = 5_000;

/** 타격 시각과 받은 시각이 같은 타격 */
function hit(t: number, pad: PadId | null = 'SNARE', tRecv: number = t) {
  return { pad, tHit: t, tRecv };
}

describe('acceptsHit', () => {
  it('시작 시각과 정확히 같으면 포함한다', () => {
    expect(acceptsHit(START, hit(START), TEN)).toBe(true);
  });

  it('시작 시각보다 1ms 이르면 제외한다', () => {
    expect(acceptsHit(START, hit(START - 1), TEN)).toBe(false);
  });

  it('시작+9999.9는 포함하고 시작+10000은 제외한다', () => {
    expect(acceptsHit(START, hit(START + 9999.9), TEN)).toBe(true);
    expect(acceptsHit(START, hit(START + 10000), TEN)).toBe(false);
  });

  it('스네어가 아닌 패드는 제외한다', () => {
    expect(acceptsHit(START, hit(START + 100, 'HIHAT'), TEN)).toBe(false);
    expect(acceptsHit(START, hit(START + 100, 'MID_TOM'), TEN)).toBe(false);
  });

  it('패드를 판정하지 못한 타격(pad null)은 제외한다', () => {
    expect(acceptsHit(START, hit(START + 100, null), TEN)).toBe(false);
  });

  it('받은 시각이 구간 밖이어도 타격 시각이 구간 안이면 포함한다(늦게 도착한 타격)', () => {
    expect(acceptsHit(START, { pad: 'SNARE', tHit: START + 9990, tRecv: START + 10040 }, TEN)).toBe(true);
  });

  it('타격 시각이 받은 시각보다 뒤로 계산되면 받은 시각으로 가린다', () => {
    // 받은 시각은 구간 안, 타격 시각은 구간 밖(뒤)
    expect(acceptsHit(START, { pad: 'SNARE', tHit: START + 10500, tRecv: START + 9000 }, TEN)).toBe(true);
    // 받은 시각이 구간 밖(뒤)이고 타격 시각은 더 뒤
    expect(acceptsHit(START, { pad: 'SNARE', tHit: START + 10500, tRecv: START + 10100 }, TEN)).toBe(false);
  });

  it('카운트다운 중(시작 전) 타격은 제외한다', () => {
    expect(acceptsHit(START, hit(START - 2000), TEN)).toBe(false);
  });
});

describe('acceptsHit — 5초 판', () => {
  it('시작+4999.9는 포함하고 시작+5000은 제외한다', () => {
    expect(acceptsHit(START, hit(START + 4999.9), FIVE)).toBe(true);
    expect(acceptsHit(START, hit(START + 5000), FIVE)).toBe(false);
  });

  it('10초 판이면 세는 6초째 타격을 5초 판은 세지 않는다', () => {
    expect(acceptsHit(START, hit(START + 6000), TEN)).toBe(true);
    expect(acceptsHit(START, hit(START + 6000), FIVE)).toBe(false);
  });
});

describe('acceptedOffsets', () => {
  it('구간 안 스네어만 남는다', () => {
    const hits = [hit(START + 100), hit(START + 200, 'HIHAT'), hit(START + 300, null), hit(START + 400)];
    expect(acceptedOffsets(START, hits, TEN)).toEqual([100, 400]);
  });

  it('시작 시각을 뺀 값이다', () => {
    expect(acceptedOffsets(START, [hit(START), hit(START + 1234.5), hit(START + 9999)], TEN)).toEqual([0, 1234.5, 9999]);
  });

  it('집계 시각(타격 시각과 받은 시각 중 이른 값)에서 시작 시각을 뺀다', () => {
    expect(acceptedOffsets(START, [{ pad: 'SNARE', tHit: START + 9990, tRecv: START + 10040 }], TEN)).toEqual([9990]);
    expect(acceptedOffsets(START, [{ pad: 'SNARE', tHit: START + 700, tRecv: START + 500 }], TEN)).toEqual([500]);
  });

  it('입력 순서와 무관하게 오름차순이다', () => {
    const hits = [hit(START + 3000), hit(START + 100), hit(START + 9000), hit(START + 100), hit(START + 500)];
    expect(acceptedOffsets(START, hits, TEN)).toEqual([100, 100, 500, 3000, 9000]);
  });

  it('카운트다운 중(시작 전)·끝난 뒤(시작+10000 이상)·다른 패드는 빠진다', () => {
    const hits = [
      hit(START - 2000),
      hit(START - 1),
      hit(START + 10000),
      hit(START + 12000),
      hit(START + 500, 'MID_TOM'),
      hit(START + 600, null),
      hit(START + 700),
    ];
    expect(acceptedOffsets(START, hits, TEN)).toEqual([700]);
  });

  it('끝난 뒤에 도착했어도 타격 시각이 구간 안이면 남는다', () => {
    expect(acceptedOffsets(START, [{ pad: 'SNARE', tHit: START + 9990, tRecv: START + 10100 }, hit(START + 10100)], TEN)).toEqual([9990]);
  });

  it('빈 입력이면 빈 목록', () => {
    expect(acceptedOffsets(START, [], TEN)).toEqual([]);
  });

  it('받은 목록을 바꾸지 않는다', () => {
    const hits = [hit(START + 300), hit(START + 100)];
    acceptedOffsets(START, hits, TEN);
    expect(hits.map((h) => h.tHit)).toEqual([START + 300, START + 100]);
  });
});

describe('secondBuckets', () => {
  it('빈 입력이면 0이 열 개', () => {
    expect(secondBuckets([], TEN)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('초 경계에서 칸이 바뀐다(999→0번, 1000→1번, 9999→9번)', () => {
    const b = secondBuckets([999, 1000, 9999], TEN);
    expect(b).toHaveLength(10);
    expect(b[0]).toBe(1);
    expect(b[1]).toBe(1);
    expect(b[9]).toBe(1);
  });

  it('같은 초의 타격을 합한다', () => {
    expect(secondBuckets([0, 100, 999, 2500], TEN)).toEqual([3, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('구간 밖 값(음수·10000 이상)은 무시한다', () => {
    expect(secondBuckets([-1, -500, 10000, 12000], TEN)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('secondBuckets — 5초 판', () => {
  it('칸이 다섯 개다', () => {
    expect(secondBuckets([], FIVE)).toEqual([0, 0, 0, 0, 0]);
    expect(secondBuckets([0, 999, 1000, 4999], FIVE)).toEqual([2, 1, 0, 0, 1]);
  });

  it('5000 이상은 무시한다', () => {
    expect(secondBuckets([5000, 7000], FIVE)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('hitsPerSecond', () => {
  it('열 초로 나눠 소수 한 자리로 돌려준다', () => {
    expect(hitsPerSecond(72, TEN)).toBe(7.2);
    expect(hitsPerSecond(0, TEN)).toBe(0);
    expect(hitsPerSecond(68, TEN)).toBe(6.8);
    expect(hitsPerSecond(1, TEN)).toBe(0.1);
  });
});

describe('hitsPerSecond — 5초 판', () => {
  it('다섯 초로 나눈다', () => {
    expect(hitsPerSecond(36, FIVE)).toBe(7.2);
    expect(hitsPerSecond(1, FIVE)).toBe(0.2);
  });
});

describe('제한 시간 값', () => {
  it('초 → ms', () => {
    expect(speedDurationMs(5)).toBe(5000);
    expect(speedDurationMs(10)).toBe(10000);
  });

  it('10초는 갈래가 없고 5초는 `5s`다', () => {
    expect(speedVariant(10)).toBeUndefined();
    expect(speedVariant(5)).toBe('5s');
  });

  it('갈래 표는 10초(갈래 없음)·5초 순서다', () => {
    expect(SPEED_VARIANTS).toEqual([{ name: '10초' }, { id: '5s', name: '5초' }]);
  });

  it('저장 글자를 읽는다. 모르는 값·없는 값은 10초다', () => {
    expect(parseSpeedSeconds('5')).toBe(5);
    expect(parseSpeedSeconds('10')).toBe(10);
    expect(parseSpeedSeconds('7')).toBe(10);
    expect(parseSpeedSeconds('')).toBe(10);
    expect(parseSpeedSeconds(null)).toBe(10);
    expect(parseSpeedSeconds(undefined)).toBe(10);
  });
});

describe('speedHeat (설계 MODE-006-minigame-speed-ui D11)', () => {
  it('10초 판: 10타마다 칸이 오른다', () => {
    expect(speedHeat(0, 10)).toEqual({ tier: 0, step: 0 });
    expect(speedHeat(9, 10)).toEqual({ tier: 0, step: 0 });
    expect(speedHeat(10, 10)).toEqual({ tier: 0, step: 1 });
    expect(speedHeat(39, 10)).toEqual({ tier: 0, step: 3 });
    expect(speedHeat(49, 10)).toEqual({ tier: 0, step: 4 });
  });

  it('10초 판: 50타와 100타에서 단계가 바뀌고 칸은 0으로 돌아간다', () => {
    expect(speedHeat(50, 10)).toEqual({ tier: 1, step: 0 });
    expect(speedHeat(99, 10)).toEqual({ tier: 1, step: 4 });
    expect(speedHeat(100, 10)).toEqual({ tier: 2, step: 0 });
  });

  it('마지막 단계에서는 칸이 4에서 멈춘다', () => {
    expect(speedHeat(149, 10)).toEqual({ tier: 2, step: 4 });
    expect(speedHeat(400, 10)).toEqual({ tier: 2, step: 4 });
  });

  it('5초 판은 경계가 절반이다(5타마다 칸, 25타·50타에서 단계)', () => {
    expect(speedHeat(4, 5)).toEqual({ tier: 0, step: 0 });
    expect(speedHeat(5, 5)).toEqual({ tier: 0, step: 1 });
    expect(speedHeat(24, 5)).toEqual({ tier: 0, step: 4 });
    expect(speedHeat(25, 5)).toEqual({ tier: 1, step: 0 });
    expect(speedHeat(50, 5)).toEqual({ tier: 2, step: 0 });
  });

  it('음수는 0타로 본다', () => {
    expect(speedHeat(-3, 10)).toEqual({ tier: 0, step: 0 });
  });
});

describe('currentRate', () => {
  it('지금−1000 초과, 지금 이하인 타격만 센다', () => {
    // now=2000 → (1000, 2000]
    expect(currentRate([1000, 1001, 1500, 2000, 2001], 2000)).toBe(3);
  });

  it('경계값: 정확히 1초 전은 세지 않고, 지금은 세고, 지금보다 뒤는 세지 않는다', () => {
    expect(currentRate([1000], 2000)).toBe(0);
    expect(currentRate([2000], 2000)).toBe(1);
    expect(currentRate([2001], 2000)).toBe(0);
  });

  it('시작 직후에는 지금까지의 타격을 센다', () => {
    expect(currentRate([0, 50, 100], 100)).toBe(3);
    expect(currentRate([], 100)).toBe(0);
  });
});

describe('peakSecond', () => {
  it('가장 많이 친 초와 그 타수를 1부터 센 초로 돌려준다', () => {
    expect(peakSecond([1, 2, 7, 3, 0, 0, 0, 0, 0, 0])).toEqual({ count: 7, second: 3 });
  });

  it('마지막 초가 최대여도 맞게 센다', () => {
    expect(peakSecond([0, 0, 0, 0, 0, 0, 0, 0, 0, 5])).toEqual({ count: 5, second: 10 });
  });

  it('동률이면 앞선 초를 돌려준다', () => {
    expect(peakSecond([1, 6, 2, 6, 6, 0, 0, 0, 0, 0])).toEqual({ count: 6, second: 2 });
  });

  it('모두 0이면 1초', () => {
    expect(peakSecond([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual({ count: 0, second: 1 });
  });
});

describe('speedVerdict', () => {
  it('0타는 zero(이전 기록과 무관)', () => {
    expect(speedVerdict(0, null)).toBe('zero');
    expect(speedVerdict(0, 50)).toBe('zero');
  });

  it('이전 기록이 없으면 first', () => {
    expect(speedVerdict(30, null)).toBe('first');
  });

  it('이전보다 많으면 best, 같으면 tie, 적으면 short', () => {
    expect(speedVerdict(60, 50)).toBe('best');
    expect(speedVerdict(50, 50)).toBe('tie');
    expect(speedVerdict(40, 50)).toBe('short');
  });
});

describe('speedResultTitle (설계 4절 「결과 제목」)', () => {
  it('0타', () => {
    expect(speedResultTitle(0, null, 10)).toEqual(['스네어를 한 번도 못 쳤어요.', '스틱 연결과 스네어 위치를 확인해 보세요.']);
  });

  it('첫 기록', () => {
    expect(speedResultTitle(42, null, 10)).toEqual(['10초에 42타.', '첫 기록이에요.']);
  });

  it('최고 기록 갱신', () => {
    expect(speedResultTitle(55, 50, 10)).toEqual(['10초에 55타.', '지난 기록보다 5타 많아요.']);
  });

  it('동점', () => {
    expect(speedResultTitle(50, 50, 10)).toEqual(['10초에 50타.', '최고 기록과 같아요.']);
  });

  it('못 미침', () => {
    expect(speedResultTitle(47, 50, 10)).toEqual(['10초에 47타.', '최고 기록까지 3타 남았어요.']);
  });
});

describe('speedResultTitle — 5초 판', () => {
  it('첫 줄이 「5초에 N타.」다', () => {
    expect(speedResultTitle(21, null, 5)).toEqual(['5초에 21타.', '첫 기록이에요.']);
    expect(speedResultTitle(30, 25, 5)).toEqual(['5초에 30타.', '지난 기록보다 5타 많아요.']);
  });
});

describe('isSpeedDetail', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('음이 아닌 정수 열 개면 참', () => {
    expect(isSpeedDetail({ perSecond: ten })).toBe(true);
    expect(isSpeedDetail({ perSecond: new Array(10).fill(0) })).toBe(true);
  });

  it('음이 아닌 정수 다섯 개(5초 판)도 참', () => {
    expect(isSpeedDetail({ perSecond: ten.slice(0, 5) })).toBe(true);
  });

  it('길이가 5도 10도 아니면 거짓', () => {
    expect(isSpeedDetail({ perSecond: ten.slice(0, 9) })).toBe(false);
    expect(isSpeedDetail({ perSecond: ten.slice(0, 4) })).toBe(false);
    expect(isSpeedDetail({ perSecond: ten.slice(0, 6) })).toBe(false);
    expect(isSpeedDetail({ perSecond: [...ten, 11] })).toBe(false);
    expect(isSpeedDetail({ perSecond: [] })).toBe(false);
  });

  it('음수·소수·문자열이 섞이면 거짓', () => {
    expect(isSpeedDetail({ perSecond: [...ten.slice(0, 9), -1] })).toBe(false);
    expect(isSpeedDetail({ perSecond: [...ten.slice(0, 9), 1.5] })).toBe(false);
    expect(isSpeedDetail({ perSecond: [...ten.slice(0, 9), '3'] })).toBe(false);
  });

  it('null·배열·원시값·perSecond 없음이면 거짓', () => {
    expect(isSpeedDetail(null)).toBe(false);
    expect(isSpeedDetail(undefined)).toBe(false);
    expect(isSpeedDetail(ten)).toBe(false);
    expect(isSpeedDetail('x')).toBe(false);
    expect(isSpeedDetail({})).toBe(false);
    expect(isSpeedDetail({ perSecond: 'abcdefghij' })).toBe(false);
  });
});
