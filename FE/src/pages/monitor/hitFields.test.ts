import { describe, expect, it } from 'vitest';
import { HIT_FIELDS, hexGroups, hexSpaced } from './hitFields';

describe('HIT 필드 경계표', () => {
  it('경계가 빈틈·겹침 없이 0~20바이트를 덮는다', () => {
    let pos = 0;
    for (const f of HIT_FIELDS) {
      expect(f.start).toBe(pos);
      expect(f.end).toBeGreaterThan(f.start);
      pos = f.end;
    }
    expect(pos).toBe(20);
  });
});

describe('hexGroups', () => {
  it('20바이트를 13개 필드로 묶는다', () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i);
    const g = hexGroups(bytes);
    expect(g).toHaveLength(13);
    expect(g[3]).toEqual({ key: 'ts', start: 3, end: 7, hex: '03 04 05 06' });
    expect(g[6].hex).toBe('09 0A');
    expect(g[12]).toEqual({ key: 'decel', start: 19, end: 20, hex: '13' });
  });

  it('짧은 패킷은 가진 바이트까지만, 걸친 필드는 잘라서 묶는다', () => {
    const g = hexGroups(new Uint8Array([1, 2, 3, 4, 5]));
    expect(g.map((x) => x.key)).toEqual(['type', 'flags', 'seq', 'ts']);
    expect(g[3]).toEqual({ key: 'ts', start: 3, end: 5, hex: '04 05' });
  });

  it('빈 배열은 빈 묶음', () => {
    expect(hexGroups(new Uint8Array())).toEqual([]);
  });
});

describe('hexSpaced', () => {
  it('대문자 2자리를 공백으로 잇는다', () => {
    expect(hexSpaced(new Uint8Array([0, 255, 16]))).toBe('00 FF 10');
  });
});
