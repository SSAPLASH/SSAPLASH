// 보정·재정렬 문구 검증(PLAY-004 4-1·3-9).
import { describe, expect, it } from 'vitest';
import { captureCardTitle, captureHeadline, captureLine, capturePillText, hitCountText, realignPromptText, spreadWarningText } from './calibrationText';

describe('captureLine', () => {
  it('양손이면 "2번씩", 한 손이면 그 손으로 "2번". 조사는 받침에 맞춘다', () => {
    expect(captureLine('SNARE', [0, 1])).toBe('스네어를 양손으로 2번씩 쳐 주세요');
    expect(captureLine('HIHAT', [0])).toBe('하이햇을 왼손으로 2번 쳐 주세요');
    expect(captureLine('RIDE', [1])).toBe('라이드를 오른손으로 2번 쳐 주세요');
  });
});

describe('UX-64 보정 카드 문구', () => {
  it('큰 안내: 양손이면 손 없이, 한 손이면 그 손으로. 조사 처리', () => {
    expect(captureHeadline('HIHAT', [0, 1])).toBe('하이햇을 2번 타격하세요');
    expect(captureHeadline('RIDE', [0, 1])).toBe('라이드를 2번 타격하세요');
    expect(captureHeadline('SNARE', [1])).toBe('스네어를 오른손으로 2번 타격하세요');
  });
  it('카드 제목·pill은 1부터 센다', () => {
    expect(captureCardTitle('HIHAT', 0, 7)).toBe('하이햇 2회 타격 (1/7)');
    expect(captureCardTitle('RIDE', 6, 7)).toBe('라이드 2회 타격 (7/7)');
    expect(capturePillText(2, 7)).toBe('보정 중 3 / 7');
  });
  it('타격 줄: 양손 "왼 a/2 · 오 b/2", 한 손 "a/2"', () => {
    expect(hitCountText([0, 1], [1, 2])).toBe('왼 1/2 · 오 2/2');
    expect(hitCountText([1], [0, 2])).toBe('2/2');
    expect(hitCountText([0], [1, 0])).toBe('1/2');
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
