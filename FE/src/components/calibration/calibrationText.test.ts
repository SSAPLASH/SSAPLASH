// 보정·재정렬 문구 검증(PLAY-004 4-1·3-9).
import { describe, expect, it } from 'vitest';
import { captureLine, realignPromptText, spreadWarningText } from './calibrationText';

describe('captureLine', () => {
  it('양손이면 "2번씩", 한 손이면 그 손으로 "2번". 조사는 받침에 맞춘다', () => {
    expect(captureLine('SNARE', [0, 1])).toBe('스네어를 양손으로 2번씩 쳐 주세요');
    expect(captureLine('HIHAT', [0])).toBe('하이햇을 왼손으로 2번 쳐 주세요');
    expect(captureLine('RIDE', [1])).toBe('라이드를 오른손으로 2번 쳐 주세요');
  });
});

describe('spreadWarningText', () => {
  it('각도는 반올림, 손·패드를 짚는다', () => {
    expect(spreadWarningText({ pad: 'SMALL_TOM', stickId: 1, spread: 11.6 })).toBe(
      '두 번 친 자리가 너무 달라요(12°). 오른손으로 스몰탐을 다시 쳐 주세요',
    );
  });
});

describe('realignPromptText', () => {
  it('두 손 남음 / 한 손 남음 / 다 끝남', () => {
    expect(realignPromptText([0, 1], [false, false])).toBe('스네어를 왼손·오른손 한 번씩 쳐 주세요');
    expect(realignPromptText([0, 1], [true, false])).toBe('오른손으로 스네어를 한 번 쳐 주세요');
    expect(realignPromptText([0], [false, false])).toBe('왼손으로 스네어를 한 번 쳐 주세요');
    expect(realignPromptText([0], [true, false])).toBe('스네어 재정렬을 마쳤어요');
  });
});
