// SheetPager 순수 계산 테스트 (페이지당 마디 수, 슬롯 교체, 커서, 박 스냅)
import { describe, expect, it } from 'vitest';
import { xInBar, xInBarContinuous, xOfTimeInBar } from '@/components/sheetmusic/sheetStripMath';
import { barsPerPage, cursorPos, flowGeometry, pagerSlots, snapToBeat } from './sheetPagerMath';

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

describe('커서와 머리 중심 x', () => {
  it('노트 시각에서 커서 x가 그 노트 머리 중심 x와 같다', () => {
    const slotW = 200;
    const gutter = 44;
    // 마디 6(0부터 5)의 2번째 박 노트: 4마디/페이지라 슬롯 1
    const bar = 5;
    const ratio = 0.25;
    const t = bar * BAR_MS + ratio * BAR_MS;
    const { slot, ratio: r } = cursorPos(t, BAR_MS, 4);
    const cursorX = xInBar(gutter + slot * slotW, slotW, r);
    const headX = xInBar(gutter + (bar % 4) * slotW, slotW, ratio);
    expect(slot).toBe(bar % 4);
    expect(cursorX).toBeCloseTo(headX);
  });
});

describe('snapToBeat', () => {
  it('박 경계로 내린다', () => {
    expect(snapToBeat(1200, BEAT_MS)).toBe(1000);
    expect(snapToBeat(1000, BEAT_MS)).toBe(1000);
    expect(snapToBeat(0, BEAT_MS)).toBe(0);
  });
});


describe('연속 악보 좌표', () => {
  it.each([360, 640, 1280])('폭 %spx에서 페이지와 마디 경계를 끊김 없이 지나고 모든 칸이 음표 중심과 맞는다', (width) => {
    const gutter = 44;
    const barPx = (width - gutter) / barsPerPage(width - gutter);
    const geometry = (t: number) => flowGeometry(t, BAR_MS, 16, width, gutter, barPx, 20, 0);
    for (let step = 0; step < 16 * 8; step++) {
      const t = step * BAR_MS / 16;
      const g = geometry(t);
      const bar = Math.floor(step / 16);
      expect(g.cursorX).toBeCloseTo(xInBarContinuous(g.barZeroX + bar * barPx, barPx, (step % 16) / 16, 16));
      expect(g.cursorX).toBeCloseTo(xOfTimeInBar(t, 0, width, barPx, g.barZeroX / width, BAR_MS, 0, 16));
    }
    for (const boundary of [BAR_MS, 2 * BAR_MS, 4 * BAR_MS]) {
      const before = geometry(boundary - 0.001), after = geometry(boundary + 0.001);
      expect(Math.abs(after.cursorX - before.cursorX)).toBeLessThan(0.01);
      expect(Math.abs(after.barZeroX - before.barZeroX)).toBeLessThan(0.01);
    }
    const position = (t: number) => { const g = geometry(t); return g.cursorX - g.barZeroX; };
    expect(position(BAR_MS) - position(BAR_MS - 125)).toBeCloseTo(position(BAR_MS + 125) - position(BAR_MS));
    expect(geometry(0).cursorX).toBeCloseTo(xInBarContinuous(gutter, barPx, 0, 16));
    expect(geometry(8 * BAR_MS).cursorX).toBeCloseTo(width * 0.36);
  });

  it('준비 마디 앞은 멈추고 준비 마디에서 첫 음표까지 이어지며 시킹과 크기 변경에도 좌표가 맞는다', () => {
    const flow = (t: number, width: number) => flowGeometry(t, BAR_MS, 16, width, 44, (width - 44) / barsPerPage(width - 44), 20, 1);
    expect(flow(-3 * BAR_MS, 640)).toEqual(flow(-BAR_MS, 640));
    expect(Math.abs(flow(-0.001, 640).cursorX - flow(0, 640).cursorX)).toBeLessThan(0.01);
    for (const width of [640, 1280]) {
      const g = flow(5 * BAR_MS, width);
      const barPx = (width - 44) / barsPerPage(width - 44);
      expect(g.cursorX).toBeCloseTo(xInBarContinuous(g.barZeroX + 5 * barPx, barPx, 0, 16));
      expect(flow(5 * BAR_MS, width)).toEqual(g);
    }
  });
});
