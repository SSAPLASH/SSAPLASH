// SheetPager 순수 계산 테스트 (페이지당 마디 수, 슬롯 교체, 커서, 박 스냅)
import { describe, expect, it } from 'vitest';
import { barsPerPage, cursorPos, pagerSlots, snapToBeat } from './sheetPagerMath';

// 120 BPM 4/4: 박 500ms, 마디 2000ms
const BAR_MS = 2000;
const BEAT_MS = 500;
// 1부터 센 마디 번호, 흐림은 '~', 빈 슬롯은 null
const view = (t: number, perPage = 4, total = 100) =>
  pagerSlots(t, BAR_MS, BEAT_MS, perPage, total).map((s) => (s.bar === null ? null : `${s.bar + 1}${s.upcoming ? '~' : ''}`));

describe('barsPerPage', () => {
  it('폭 900 미만은 2마디, 이상은 4마디', () => {
    expect(barsPerPage(899)).toBe(2);
    expect(barsPerPage(900)).toBe(4);
    expect(barsPerPage(1400)).toBe(4);
  });
});

describe('pagerSlots (4마디/페이지, 설계 4장 예시)', () => {
  it('마디 1 중: 1 2 3 4, 커서 슬롯 0', () => {
    expect(view(1000)).toEqual(['1', '2', '3', '4']);
    expect(cursorPos(1000, BAR_MS, 4).slot).toBe(0);
  });
  it('마디 2 시작 직후(1박 미만): 1 2 3 4, 커서 슬롯 1', () => {
    expect(view(2200)).toEqual(['1', '2', '3', '4']);
    expect(cursorPos(2200, BAR_MS, 4).slot).toBe(1);
  });
  it('마디 2, 1박 뒤: 5(흐림) 2 3 4, 커서 슬롯 1', () => {
    expect(view(2500)).toEqual(['5~', '2', '3', '4']);
    expect(cursorPos(2500, BAR_MS, 4).slot).toBe(1);
  });
  it('마디 4 중: 5 6 7(흐림) 4, 커서 슬롯 3', () => {
    expect(view(7000)).toEqual(['5~', '6~', '7~', '4']);
    expect(cursorPos(7000, BAR_MS, 4).slot).toBe(3);
  });
  it('마디 5 시작: 5 6 7 8(모두 정상, 새 페이지가 현재 페이지), 커서 슬롯 0', () => {
    expect(view(8000)).toEqual(['5', '6', '7', '8']);
    expect(cursorPos(8000, BAR_MS, 4).slot).toBe(0);
  });

  it('카운트인(songTime < 0)은 첫 페이지다', () => {
    expect(view(-1500)).toEqual(['1', '2', '3', '4']);
  });
  it('곡 끝 너머 슬롯은 null이다', () => {
    expect(view(0, 4, 3)).toEqual(['1', '2', '3', null]);
    expect(view(2500, 4, 4)).toEqual([null, '2', '3', '4']);
  });
  it('2마디/페이지도 같은 규칙이다', () => {
    expect(view(1000, 2)).toEqual(['1', '2']);
    expect(view(2500, 2)).toEqual(['3~', '2']);
    expect(view(4000, 2)).toEqual(['3', '4']);
  });
});

describe('cursorPos', () => {
  it('슬롯과 마디 안 비율을 돌려준다', () => {
    expect(cursorPos(1000, BAR_MS, 4)).toEqual({ slot: 0, ratio: 0.5 });
    expect(cursorPos(5000, BAR_MS, 4)).toEqual({ slot: 2, ratio: 0.5 });
    expect(cursorPos(9000, BAR_MS, 4)).toEqual({ slot: 0, ratio: 0.5 });
  });
  it('카운트인이면 슬롯 0, 비율 0', () => {
    expect(cursorPos(-300, BAR_MS, 4)).toEqual({ slot: 0, ratio: 0 });
  });
});

describe('snapToBeat', () => {
  it('박 경계로 내린다', () => {
    expect(snapToBeat(1200, BEAT_MS)).toBe(1000);
    expect(snapToBeat(1000, BEAT_MS)).toBe(1000);
    expect(snapToBeat(0, BEAT_MS)).toBe(0);
  });
});
