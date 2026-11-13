// 드럼 배치 판 높이 계산 검증: 한 화면 맞춤과 낮은 화면에서 지키는 높이.
import { describe, expect, it } from 'vitest';
import { STAGE_TARGET_H, stageMaxHeight } from './useStageFit';

describe('stageMaxHeight', () => {
  // 판 위쪽 307px(상단바 56 포함), 하단 바 77px, 상단바 56px
  const fit = (innerHeight: number) => stageMaxHeight(innerHeight, 307, 77, 56);

  it('화면이 높으면 한 화면에 맞춘다', () => {
    expect(fit(900)).toBe(500);
    expect(fit(1080)).toBe(680);
  });

  it('화면이 낮으면 한 화면 맞춤을 풀고 지키는 높이까지 키운다', () => {
    // 노트북 창(내용 영역 721px): 한 화면 맞춤은 321px
    expect(fit(721)).toBe(STAGE_TARGET_H);
    expect(fit(800)).toBe(STAGE_TARGET_H);
  });

  it('스크롤했을 때 상단바와 하단 바 사이에 다 보이는 높이를 넘지 않는다', () => {
    // 600 − 56 − 77 − 32 = 435
    expect(fit(600)).toBe(435);
  });

  it('맞춤 높이와 지키는 높이의 경계에서 값이 이어진다', () => {
    expect(fit(899)).toBe(500);
    expect(fit(901)).toBe(501);
  });

  it('잴 수 없으면 null', () => {
    expect(stageMaxHeight(0, 0, 0)).toBeNull();
    expect(stageMaxHeight(Number.NaN, 0, 0)).toBeNull();
    expect(stageMaxHeight(100, 300, 77, 56)).toBeNull();
  });
});
