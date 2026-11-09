import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartFromDetail, type ChartDetailDto } from './chartMapping';

function dto(over: Partial<ChartDetailDto> = {}): ChartDetailDto {
  return {
    id: 34,
    songId: 12,
    title: '연습곡',
    source: 'BUILTIN',
    difficulty: 'EASY',
    chartVersionId: 77,
    version: 1,
    schemaVersion: 1,
    bpm: 120,
    offsetMs: 250,
    timeSignature: '4/4',
    beatsPerBar: 4,
    durationMs: 8000,
    timing: { bpm: 120, offsetMs: 250, timeSignature: '4/4', tempoMap: [{ tick: 0, bpm: 120 }], timeSignatureMap: [] },
    noteCount: 2,
    notes: [
      { noteId: 'n1', timeMs: 500, pad: 'KICK', velocityHint: 100 },
      { noteId: 'n2', timeMs: 1000, pad: 'SNARE', velocityHint: null },
    ],
    notationStatus: 'READY',
    hasSheetImages: false,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('chartFromDetail', () => {
  it('id를 number로 옮기고 songId는 문자열 필드에도 채운다', () => {
    const c = chartFromDetail(dto(), true);
    expect(c.chartVersionId).toBe(77);
    expect(c.songNumericId).toBe(12);
    expect(c.chartId).toBe(34);
    expect(c.songId).toBe('12');
    expect(c.hasAccompaniment).toBe(true);
  });

  it('안전한 정수가 아닌 id는 거부한다', () => {
    expect(() => chartFromDetail(dto({ chartVersionId: 2 ** 60 }), false)).toThrow();
    expect(() => chartFromDetail(dto({ songId: 1.5 }), false)).toThrow();
  });

  it('알 수 없는 pad 노트는 버리고 경고는 한 번만 낸다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chartFromDetail(
      dto({
        notes: [
          { noteId: 'a', timeMs: 0, pad: 'COWBELL' },
          { noteId: 'b', timeMs: 100, pad: 'COWBELL' },
          { noteId: 'c', timeMs: 200, pad: 'HIHAT' },
        ],
      }),
      false,
    );
    expect(c.notes).toEqual([{ timeMs: 200, pad: 'HIHAT', noteId: 'c' }]);
    // 버린 노트가 있으면 BE 노트 수와 달라진다(업로드 제외 판정용)
    expect(c.sourceNoteCount).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('옛 이름 HI_TOM 노트는 SMALL_TOM 노트가 된다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chartFromDetail(dto({ notes: [{ noteId: 'a', timeMs: 300, pad: 'HI_TOM' }] }), false);
    expect(c.notes).toEqual([{ timeMs: 300, pad: 'SMALL_TOM', noteId: 'a' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('timeMs에 offsetMs를 더하지 않고 순서·noteId를 유지하며 velocityHint null은 생략한다', () => {
    const c = chartFromDetail(dto(), false);
    expect(c.notes).toEqual([
      { timeMs: 500, pad: 'KICK', velocityHint: 100, noteId: 'n1' },
      { timeMs: 1000, pad: 'SNARE', noteId: 'n2' },
    ]);
    expect(c.offsetMs).toBe(250);
  });

  it('durationMs가 null이면 마지막 노트 + 1마디', () => {
    // 120bpm 4/4 → 1마디 2000ms
    const c = chartFromDetail(dto({ durationMs: null }), false);
    expect(c.durationMs).toBe(3000);
  });

  it('durationMs가 null이고 노트가 없으면 1마디', () => {
    const c = chartFromDetail(dto({ durationMs: null, notes: [] }), false);
    expect(c.durationMs).toBe(2000);
  });

  it('durationMs가 있으면 그대로 쓴다', () => {
    expect(chartFromDetail(dto({ durationMs: 9999 }), false).durationMs).toBe(9999);
  });

  it('tempoMap 또는 timeSignatureMap 길이가 1 초과면 variableTempo', () => {
    expect(chartFromDetail(dto(), false).variableTempo).toBeUndefined();
    const t = dto().timing!;
    const tempo = chartFromDetail(
      dto({ timing: { ...t, tempoMap: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }] } }),
      false,
    );
    expect(tempo.variableTempo).toBe(true);
    const sig = chartFromDetail(
      dto({
        timing: {
          ...t,
          timeSignatureMap: [
            { tick: 0, numerator: 4, denominator: 4 },
            { tick: 1920, numerator: 3, denominator: 4 },
          ],
        },
      }),
      false,
    );
    expect(sig.variableTempo).toBe(true);
  });

  it('tempoMap이 둘 이상이고 ppq가 있으면 tempoSegments를 만든다', () => {
    const t = dto().timing!;
    const plain = chartFromDetail(dto(), false);
    expect(plain.tempoSegments).toBeUndefined();
    const c = chartFromDetail(
      dto({ timing: { ...t, ppq: 480, tempoMap: [{ tick: 0, bpm: t.bpm }, { tick: 1920, bpm: t.bpm / 2 }] } }),
      false,
    );
    expect(c.tempoSegments).toHaveLength(2);
    expect(c.tempoSegments![0].startMs).toBe(dto().offsetMs);
    expect(c.tempoSegments![1].beat).toBe(4);
    expect(c.tempoSegments![1].startMs).toBeCloseTo(dto().offsetMs + (4 * 60_000) / t.bpm, 9);
  });

  it('timing이 없어도 변환된다', () => {
    const c = chartFromDetail(dto({ timing: null }), false);
    expect(c.variableTempo).toBeUndefined();
    expect(c.bpm).toBe(120);
  });
});

it('HIHAT의 엄격한 true만 열린 상태로 보존한다', () => {
  const notes = [true, false, null, undefined, 'true'].map((hihatOpen, i) => ({ noteId: String(i), timeMs: i, pad: 'HIHAT', hihatOpen }));
  const c = chartFromDetail(dto({ notes: [...notes, { noteId: 'x', timeMs: 6, pad: 'SNARE', hihatOpen: true }] as ChartDetailDto['notes'] }), false);
  expect(c.notes.map((n) => n.hihatOpen)).toEqual([true, undefined, undefined, undefined, undefined, undefined]);
});
