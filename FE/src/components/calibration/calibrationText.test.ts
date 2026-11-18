// 보정·재정렬 문구 검증(PLAY-004 4-1·3-9).
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_GUIDE_TEXT,
  RESULT_GUIDE_TEXT,
  captureHeadline,
  captureLine,
  capturePillText,
  captureProgressText,
  gapAdviceText,
  gapWarningText,
  overlapLineText,
  overlapBannerText,
  realignPromptText,
  spreadWarningText,
  wrongHandText,
} from './calibrationText';

describe('captureLine', () => {
  it('양손이면 "2번씩", 한 손이면 그 손으로 "2번". 조사는 받침에 맞춘다', () => {
    expect(captureLine('SNARE', [0, 1])).toBe('스네어를 양손으로 2번씩 쳐 주세요');
    expect(captureLine('HIHAT', [0])).toBe('하이햇을 왼손으로 2번 쳐 주세요');
    expect(captureLine('RIDE', [1])).toBe('라이드를 오른손으로 2번 쳐 주세요');
  });
});

describe('UX-64 보정 카드 문구', () => {
  it('큰 안내: 양손이면 손 없이, 한 손이면 그 손으로. 조사 처리', () => {
    expect(captureHeadline('HIHAT', [0, 1])).toBe('하이햇을 양손으로 2번씩 타격하세요');
    expect(captureHeadline('RIDE', [0, 1])).toBe('라이드를 양손으로 2번씩 타격하세요');
    expect(captureHeadline('SNARE', [1])).toBe('스네어를 오른손으로 2번 타격하세요');
  });
  it('정보 카드 진행 제목·pill은 1부터 센다', () => {
    expect(captureProgressText('HIHAT', 0, 7)).toBe('하이햇 1/7');
    expect(captureProgressText('RIDE', 6, 7)).toBe('라이드 7/7');
    expect(capturePillText(2, 7)).toBe('보정 중 3 / 7');
  });
});

describe('간격 경고 문구(PLAY-004 개편)', () => {
  it('머리: 손·패드·각도(반올림 정수), 조사는 받침에 맞춘다', () => {
    expect(gapWarningText({ stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 10.4 })).toBe('왼손 크래시가 하이햇과 10°밖에 안 떨어져 있어요');
    expect(gapWarningText({ stickId: 1, pad: 'HIHAT', near: 'CRASH', deg: 9.6 })).toBe('오른손 하이햇이 크래시와 10°밖에 안 떨어져 있어요');
    expect(gapWarningText({ stickId: 1, pad: 'MID_TOM', near: 'SMALL_TOM', deg: 12 })).toBe('오른손 미드탐이 스몰탐과 12°밖에 안 떨어져 있어요');
  });
  it('쌍별 안내는 순서와 상관없고 표에 없는 쌍은 기본 문구', () => {
    const hc = '크래시는 스틱 끝을 더 높이 들고 바깥쪽으로, 하이햇은 앞쪽 아래로 쳐 보세요';
    expect(gapAdviceText('HIHAT', 'CRASH')).toBe(hc);
    expect(gapAdviceText('CRASH', 'HIHAT')).toBe(hc);
    expect(gapAdviceText('MID_TOM', 'SMALL_TOM')).toBe('두 탐을 좌우로 더 벌려서 쳐 보세요');
    expect(gapAdviceText('RIDE', 'FLOOR_TOM')).toBe('라이드는 더 높이, 플로어탐은 더 낮게 쳐 보세요');
    expect(gapAdviceText('SNARE', 'RIDE')).toBe('두 패드를 칠 때 스틱 방향을 더 다르게 해 주세요');
  });
  it('진행·결과 안내에는 [다음]·[다시] 버튼 언급이 없다', () => {
    expect(CAPTURE_GUIDE_TEXT).toBe('불이 들어온 패드를 2번 쳐요. 다 치면 다음 드럼으로 넘어가요.');
    expect(RESULT_GUIDE_TEXT).toBe('드럼을 눌러 반경을 고치거나 다시 칠 수 있어요. 주황 테두리는 서로 너무 가까운 드럼이에요.');
    expect(CAPTURE_GUIDE_TEXT + RESULT_GUIDE_TEXT).not.toMatch(/\[다음\]|\[다시\]/);
  });
  it('결과 화면 한 줄과 목록 요약', () => {
    expect(overlapLineText('CRASH', 10.2)).toBe('크래시와 10°');
    expect(overlapLineText('SNARE', 14.7)).toBe('스네어와 15°');
    expect(overlapLineText('RIDE', 8)).toBe('라이드와 8°');
    expect(overlapBannerText([{ a: 'HIHAT', b: 'CRASH', deg: 10.2, stickId: 0 }])).toBe('1쌍이 너무 가까워요 · 하이햇–크래시 10°');
    // 같은 쌍이 양손에서 겹치면 한 쌍(더 가까운 각도), 가까운 쌍부터
    expect(
      overlapBannerText([
        { a: 'SMALL_TOM', b: 'MID_TOM', deg: 14.4, stickId: 1 },
        { a: 'HIHAT', b: 'CRASH', deg: 12, stickId: 0 },
        { a: 'HIHAT', b: 'CRASH', deg: 10.2, stickId: 1 },
      ]),
    ).toBe('2쌍이 너무 가까워요 · 하이햇–크래시 10°, 스몰탐–미드탐 14°');
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

  it('unstable(방향 흔들림으로 자동 보정이 멈춤)이면 칠 손이 남았을 때만 앞에 이유를 붙인다', () => {
    expect(realignPromptText([0, 1], [false, false], true)).toBe('방향이 흔들렸어요. 스네어를 왼손·오른손 한 번씩 쳐 주세요');
    expect(realignPromptText([0, 1], [true, false], true)).toBe('방향이 흔들렸어요. 오른손으로 스네어를 한 번 쳐 주세요');
    expect(realignPromptText([0], [true, false], true)).toBe('스네어 재정렬을 마쳤어요');
    expect(realignPromptText([0, 1], [false, false], false)).toBe('스네어를 왼손·오른손 한 번씩 쳐 주세요');
  });
});

describe('PLAY-004 ① 한 손 패드 문구', () => {
  it('받을 손이 하나면 그 손으로, 둘이면 양손으로', () => {
    expect(captureHeadline('RIDE', [1])).toBe('라이드를 오른손으로 2번 타격하세요');
    expect(captureHeadline('RIDE', [0])).toBe('라이드를 왼손으로 2번 타격하세요');
    expect(captureHeadline('SNARE', [0, 1])).toBe('스네어를 양손으로 2번씩 타격하세요');
  });
  it('wrongHandText: 은/는 조사', () => {
    expect(wrongHandText('RIDE', 1)).toBe('라이드는 오른손으로 쳐요');
    expect(wrongHandText('SNARE', 0)).toBe('스네어는 왼손으로 쳐요');
    expect(wrongHandText('HIHAT', 1)).toBe('하이햇은 오른손으로 쳐요');
  });
});
