import { describe, expect, it, vi } from 'vitest';
import { diagTap, judgementToDiag, type DiagEvent } from './diagTap';

const session = (hitIds: (number | null)[]) => ({
  notes: hitIds.map((hitId) => ({ hitId })),
  songTime: (now?: number) => (now ?? 0) - 1000,
});

describe('diagTap', () => {
  it('구독자에게 시각 t를 붙여 전달한다', () => {
    const fn = vi.fn();
    const off = diagTap.subscribe(fn);
    diagTap.publish({ type: 'missed', noteIndex: 1, pad: 'SNARE', songTimeMs: 10 });
    off();
    const ev = fn.mock.calls[0][0] as DiagEvent;
    expect(ev.type).toBe('missed');
    expect(typeof ev.t).toBe('number');
  });

  it('구독 해제 후에는 받지 않고 active가 꺼진다', () => {
    const fn = vi.fn();
    const off = diagTap.subscribe(fn);
    expect(diagTap.active).toBe(true);
    off();
    diagTap.publish({ type: 'missed', noteIndex: 0, pad: 'SNARE', songTimeMs: 0 });
    expect(fn).not.toHaveBeenCalled();
    expect(diagTap.active).toBe(false);
  });

  it('구독자가 없으면 이벤트 객체를 만들지 않고 무해하다', () => {
    const spy = vi.spyOn(performance, 'now');
    expect(() => diagTap.publish({ type: 'notes', songId: 's', notes: [] })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('judgementToDiag (missed 파생, R5)', () => {
  it('MISS이고 연결된 타격이 없으면 missed', () => {
    const d = judgementToDiag(session([null, null]), { judgement: 'MISS', noteIndex: 1, pad: 'SNARE', at: 5000 });
    expect(d).toEqual({ type: 'missed', noteIndex: 1, pad: 'SNARE', songTimeMs: 4000 });
  });

  it('MISS라도 타격이 연결돼 있으면 파생하지 않는다', () => {
    expect(judgementToDiag(session([7]), { judgement: 'MISS', noteIndex: 0, pad: 'SNARE', at: 0 })).toBeNull();
  });

  it('PERFECT·GOOD은 파생하지 않는다', () => {
    const s = session([null]);
    expect(judgementToDiag(s, { judgement: 'PERFECT', noteIndex: 0, pad: 'SNARE', at: 0 })).toBeNull();
    expect(judgementToDiag(s, { judgement: 'GOOD', noteIndex: 0, pad: 'SNARE', at: 0 })).toBeNull();
  });

  it('노트 인덱스가 범위 밖이면 파생하지 않는다', () => {
    expect(judgementToDiag(session([]), { judgement: 'MISS', noteIndex: 3, pad: 'SNARE', at: 0 })).toBeNull();
  });
});
