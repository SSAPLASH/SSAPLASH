// 악보 배율(staffScale) 단위 테스트: 칸 높이에 비례하되 1.2~1.6배로 자른다
import { describe, expect, it } from 'vitest';
import { barsPerPage, CONTENT_BOTTOM, CONTENT_TOP, overlayLift, STAFF_MIN_LOGICAL_WIDTH, STAFF_SCALE_MAX, STAFF_SCALE_MIN, STAFF_SCALE_WIDE_MAX, staffOffsetY, staffScale, staffScaleMax } from './sheetPagerMath';

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

describe('staffScaleMax (넓은 칸의 최대 배율, 설계 MODE-003-practice-speed D20)', () => {
  it('폭을 모르거나 좁으면 1.6이다', () => {
    expect(staffScaleMax()).toBe(1.6);
    expect(staffScaleMax(0)).toBe(1.6);
    expect(staffScaleMax(STAFF_MIN_LOGICAL_WIDTH * 1.6)).toBeCloseTo(1.6);
    expect(staffScaleMax(700)).toBe(1.6);
  });
  it('넓으면 논리 폭이 494 아래로 내려가지 않는 만큼 커지고 2.6에서 멈춘다', () => {
    expect(staffScaleMax(988)).toBeCloseTo(2);
    expect(988 / staffScaleMax(988)).toBeCloseTo(STAFF_MIN_LOGICAL_WIDTH);
    expect(staffScaleMax(1232)).toBeCloseTo(1232 / 494);
    expect(staffScaleMax(1581)).toBe(STAFF_SCALE_WIDE_MAX);
    expect(staffScaleMax(4000)).toBe(STAFF_SCALE_WIDE_MAX);
  });
  it('그 배율에서 한 화면은 두 마디이고 마디 폭은 네 마디 배치의 가장 좁은 마디(225) 이상이다', () => {
    for (const w of [988, 1232, 1581, 2512]) {
      const inner = w / staffScaleMax(w) - 44;
      expect(barsPerPage(inner) === 2 ? inner / 2 : inner / 4).toBeGreaterThanOrEqual(225 - 1e-9);
    }
  });
  it('staffScale은 폭을 주면 그 폭의 최대까지 키운다. 높이가 모자라면 높이가 이긴다', () => {
    expect(staffScale(1000, 988)).toBeCloseTo(2);
    expect(staffScale(SPAN * 1.8, 988)).toBeCloseTo(1.8);
    expect(staffScale(1000, 700)).toBe(STAFF_SCALE_MAX);
    expect(staffScale(1000)).toBe(STAFF_SCALE_MAX);
  });
});

describe('overlayLift (타이밍 막대를 박 번호 아래로 올리는 높이)', () => {
  it('칸이 악보와 막대 자리에 딱 맞으면 0이다', () => {
    expect(overlayLift(SPAN * 1.6 + 28, 1.6, 28)).toBeCloseTo(0);
    expect(overlayLift(100, 1.6, 28)).toBe(0);
  });
  it('칸이 더 높으면 남는 높이의 절반만큼 올린다(악보가 가운데에 놓인 만큼)', () => {
    expect(overlayLift(SPAN * 1.6 + 28 + 100, 1.6, 28)).toBeCloseTo(50);
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
