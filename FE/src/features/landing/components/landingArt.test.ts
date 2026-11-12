import { describe, expect, it } from 'vitest';
import { chartArt, SHEET_RED, sheetArt, waveformBars } from './landingArt';

describe('waveformBars', () => {
  it('음원·드럼 각 140개 막대를 만든다', () => {
    const { mix, drum } = waveformBars();
    expect(mix).toHaveLength(140);
    expect(drum).toHaveLength(140);
  });

  it('첫 막대는 x=40이고 강박 막대는 드럼이 가장 크다', () => {
    const { mix, drum } = waveformBars();
    expect(mix[0].x).toBe(40);
    expect(mix[0].width).toBe(3.2);
    // i=0은 beatAt(0)=1이라 드럼 높이 118*2, 중앙 150 기준
    expect(drum[0].height).toBeCloseTo(236);
    expect(drum[0].y).toBeCloseTo(150 - 118);
    expect(drum[0].fill).toBe('#f5f5f7');
  });

  it('막대는 모두 중앙선(150) 기준 대칭이다', () => {
    const { mix, drum } = waveformBars();
    for (const b of [...mix, ...drum]) expect(b.y + b.height / 2).toBeCloseTo(150);
  });

  it('두 번 호출해도 같은 결과(결정성)', () => {
    expect(waveformBars()).toEqual(waveformBars());
  });
});

describe('chartArt', () => {
  it('레인 3개와 마디선 5개', () => {
    const c = chartArt();
    expect(c.lanes.map((l) => l.label)).toEqual(['HI-HAT', 'SNARE', 'KICK']);
    expect(c.lanes.map((l) => l.y)).toEqual([95, 160, 225]);
    expect(c.barLines).toHaveLength(5);
    expect(c.barLines[4].x1).toBe(950);
  });

  it('노트는 하이햇 32 + 스네어 4 + 킥(8의 배수 4 + 16마다 10번 2) = 42개', () => {
    const c = chartArt();
    expect(c.notes).toHaveLength(32 + 4 + 6);
    expect(c.notes[0]).toMatchObject({ x: 115, y: 88, width: 14, height: 14 });
  });

  it('결정적이다', () => {
    expect(chartArt()).toEqual(chartArt());
  });
});

describe('sheetArt', () => {
  it('5선 · 마디선 5개 · 하이햇 32개 · 마디별 빔 4개', () => {
    const s = sheetArt();
    expect(s.staffLines).toHaveLength(5);
    expect(s.barLines).toHaveLength(5);
    expect(s.hihats).toHaveLength(32);
    expect(s.beams).toHaveLength(4);
    expect(s.barLines[4].strokeWidth).toBe(2.5);
  });

  it('3마디가 강조되고 빨간 음표는 2개', () => {
    const s = sheetArt();
    expect(s.highlight.x).toBe(450);
    expect(s.highlight.width).toBe(215);
    // '3마디' 글자는 빔 아래(악보 아래)에 있고 강조 상자 안에 든다
    expect(s.highlight.labelY).toBeGreaterThan(104);
    expect(s.highlight.labelY).toBeLessThan(s.highlight.y + s.highlight.height);
    expect(s.notes.filter((n) => n.fill === SHEET_RED)).toHaveLength(2);
    // 일반 음표: 마디당 윗줄 2 + 아랫줄 2 = 16, 3마디 추가 1 = 17
    expect(s.notes).toHaveLength(17);
  });

  it('결정적이다', () => {
    expect(sheetArt()).toEqual(sheetArt());
  });
});
