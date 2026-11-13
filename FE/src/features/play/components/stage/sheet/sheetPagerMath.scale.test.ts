// 악보 배율(staffScale) 단위 테스트: 칸 높이에 비례하되 1.2~1.6배로 자른다
import { describe, expect, it } from 'vitest';
import { CONTENT_BOTTOM, CONTENT_TOP, STAFF_SCALE_MAX, STAFF_SCALE_MIN, staffOffsetY, staffScale } from './sheetPagerMath';

const SPAN = CONTENT_BOTTOM - CONTENT_TOP;

describe('staffScale', () => {
  it('상수는 1.2~1.6배', () => {
    expect(STAFF_SCALE_MIN).toBe(1.2);
    expect(STAFF_SCALE_MAX).toBe(1.6);
  });
  it('칸이 충분히 높으면 최대 1.6배', () => {
    expect(staffScale(420)).toBe(STAFF_SCALE_MAX);
    expect(staffScale(SPAN * 1.6)).toBeCloseTo(1.6);
  });
  it('중간 높이는 칸 높이에 비례한다', () => {
    expect(staffScale(SPAN * 1.4)).toBeCloseTo(1.4);
  });
  it('칸이 더 낮아도 최소 1.2배가 이긴다', () => {
    expect(staffScale(SPAN * 1.2)).toBeCloseTo(1.2);
    expect(staffScale(100)).toBe(STAFF_SCALE_MIN);
    expect(staffScale(0)).toBe(STAFF_SCALE_MIN);
  });
});

describe('staffOffsetY', () => {
  // 그린 콘텐츠의 위·아래 끝(논리 px)
  const top = (H: number, reserve = 0) => CONTENT_TOP + staffOffsetY(H, reserve);
  const bottom = (H: number, reserve = 0) => CONTENT_BOTTOM + staffOffsetY(H, reserve);

  it('칸이 콘텐츠와 높이가 같으면 콘텐츠 위 끝이 칸 위 끝이다(위 빈 곳만큼 위로 올린다)', () => {
    expect(staffOffsetY(SPAN)).toBeLessThan(0);
    expect(top(SPAN)).toBeCloseTo(0);
    expect(bottom(SPAN)).toBeCloseTo(SPAN);
  });
  it('칸이 더 높으면 위아래 여백이 같다', () => {
    const H = SPAN + 60;
    expect(top(H)).toBeCloseTo(30);
    expect(H - bottom(H)).toBeCloseTo(30);
  });
  it('아래 막대 자리(reserve)를 빼고 남은 높이의 가운데에 놓는다', () => {
    const H = SPAN + 60;
    const reserve = 40;
    expect(top(H, reserve)).toBeCloseTo(10);
    expect(H - reserve - bottom(H, reserve)).toBeCloseTo(10);
  });
  it('칸이 콘텐츠보다 낮아도 위 끝은 잘리지 않는다(넘침은 아래로)', () => {
    expect(top(SPAN - 30)).toBeCloseTo(0);
    expect(top(SPAN - 30, 20)).toBeCloseTo(0);
  });
});
