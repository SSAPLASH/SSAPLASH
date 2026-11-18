// 준비 마디(leadBars=1): 악보를 한 칸 밀어 커서가 준비 마디를 지나 1마디로 이어 들어가는지 (설계 MODE-001-lead-in-bars D20)
import { describe, expect, it } from 'vitest';
import { cursorPos, pagerSlots } from './sheetPagerMath';

const BAR_MS = 2000;
const BEAT_MS = 500;
/** 슬롯 표기: 준비 마디 'L', 마디는 1부터, 미리보기는 '~' */
const slots = (t: number, perPage = 4, total = 16) =>
  pagerSlots(t, BAR_MS, BEAT_MS, perPage, total, 1).map((s) => (s.lead ? 'L' : s.bar === null ? null : `${s.bar + 1}${s.upcoming ? '~' : ''}`));

describe('pagerSlots 준비 마디', () => {
  it('카운트다운 중(준비 마디 앞)에는 첫 칸이 준비 마디, 이어서 1·2·3마디', () => {
    expect(slots(-5000)).toEqual(['L', '1', '2', '3']);
    expect(cursorPos(-5000, BAR_MS, 4, 1)).toEqual({ slot: 0, ratio: 0 });
  });

  it('준비 마디 동안 커서가 첫 칸을 지나간다', () => {
    expect(cursorPos(-1000, BAR_MS, 4, 1)).toEqual({ slot: 0, ratio: 0.5 });
    expect(slots(-1000)).toEqual(['L', '1', '2', '3']);
  });

  it('격자 0(1마디 1박)에 커서는 둘째 칸 왼쪽 — 첫 칸으로 되돌아가지 않는다', () => {
    expect(cursorPos(0, BAR_MS, 4, 1)).toEqual({ slot: 1, ratio: 0 });
    expect(slots(0)).toEqual(['L', '1', '2', '3']);
  });

  it('1마디를 지나 1박 뒤 준비 마디 칸이 다음 페이지 마디(흐리게)로 바뀐다', () => {
    expect(slots(BEAT_MS)).toEqual(['4~', '1', '2', '3']);
  });

  it('다음 페이지는 4·5·6·7마디(한 칸 밀린 채 이어짐)', () => {
    expect(cursorPos(3 * BAR_MS, BAR_MS, 4, 1)).toEqual({ slot: 0, ratio: 0 });
    expect(slots(3 * BAR_MS)).toEqual(['4', '5', '6', '7']);
  });

  it('준비 마디 없음(leadBars 0)은 기존과 같다', () => {
    expect(pagerSlots(-1000, BAR_MS, BEAT_MS, 4, 16).map((s) => s.bar)).toEqual([0, 1, 2, 3]);
    expect(cursorPos(-1000, BAR_MS, 4)).toEqual({ slot: 0, ratio: 0 });
  });
});
