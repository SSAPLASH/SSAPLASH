import { describe, expect, it } from 'vitest';
import { SHEET_DEFS, pickFrame, pickSheet } from './sheets';
import type { FxSheetId } from './types';

const WATER: readonly FxSheetId[] = ['water-side-a', 'water-side-b', 'water-cymbal', 'water-front'];

describe('묶음 표', () => {
  it('12개, 규격 24장·6열·256px, 경로는 판 번호 v1', () => {
    const defs = Object.values(SHEET_DEFS);
    expect(defs).toHaveLength(12);
    for (const d of defs) {
      expect([d.frames, d.cols, d.framePx]).toEqual([24, 6, 256]);
      expect(d.src).toBe(`/fx/${d.id}.v1.webp`);
    }
    expect(SHEET_DEFS['water-side-a']).toMatchObject({ durMs: 640, tpow: 1.5, span: 3.8, cy: 0.66 });
    expect(SHEET_DEFS['bolt-front']).toMatchObject({ durMs: 360, tpow: 1.3, span: 4.4, cy: 0.5 });
    expect(SHEET_DEFS['fire-cymbal']).toMatchObject({ durMs: 440, tpow: 1.5, span: 4.2, cy: 0.6 });
  });
});

describe('pickFrame', () => {
  const water = SHEET_DEFS['water-side-a'];
  const bolt = SHEET_DEFS['bolt-side-a'];
  it('처음은 0번 장, 섞는 비율 0', () => {
    expect(pickFrame(water, 0)).toEqual({ a: 0, b: 1, mix: 0 });
  });
  it('중간: 지수 1.5의 역산(나이 절반 → u = 0.5^(1/1.5) × 23)', () => {
    const f = pickFrame(water, 320)!;
    const u = Math.pow(0.5, 1 / 1.5) * 23;
    expect(f.a).toBe(Math.floor(u));
    expect(f.b).toBe(f.a + 1);
    expect(f.mix).toBeCloseTo(u - Math.floor(u));
  });
  it('지수 1.3도 같은 식', () => {
    const f = pickFrame(bolt, 180)!;
    const u = Math.pow(0.5, 1 / 1.3) * 23;
    expect(f.a).toBe(Math.floor(u));
    expect(f.mix).toBeCloseTo(u - Math.floor(u));
  });
  it('끝 직전: 마지막 장 근처에서 뒤 장이 범위를 넘으면 앞 장만(b = -1)', () => {
    const f = pickFrame(water, 639.9999)!;
    expect(f.a).toBe(22);
    expect(f.b).toBe(23);
    // 장수가 1이면 뒤 장이 없다
    const two = { ...water, frames: 2, tpow: 1 };
    expect(pickFrame(two, 0)).toEqual({ a: 0, b: 1, mix: 0 });
    expect(pickFrame({ ...two, frames: 1 }, 100)).toEqual({ a: 0, b: -1, mix: 0 });
  });
  it('끝난 뒤·시작 전은 없음', () => {
    expect(pickFrame(water, 640)).toBeNull();
    expect(pickFrame(water, 9999)).toBeNull();
    expect(pickFrame(water, -1)).toBeNull();
  });
  it('재생 속도를 곱한 나이로 계산한다', () => {
    expect(pickFrame(water, 400, 1.3)).toEqual(pickFrame(water, 520));
    expect(pickFrame(water, 500, 1.3)).toBeNull();
  });
  it('앞 장은 시간에 따라 줄지 않는다', () => {
    let prev = 0;
    for (let t = 0; t < 640; t += 5) {
      const f = pickFrame(water, t)!;
      expect(f.a).toBeGreaterThanOrEqual(prev);
      prev = f.a;
    }
  });
});

describe('pickSheet', () => {
  const never = () => {
    throw new Error('난수를 쓰면 안 된다');
  };
  it('킥은 정면, 난수를 쓰지 않는다', () => {
    expect(pickSheet(WATER, 'kick', 70, 70, never)).toBe('water-front');
  });
  it('원판 심벌(ry/rx = 1)은 정면, 옆 심벌은 cymbal', () => {
    expect(pickSheet(WATER, 'cymbal', 50, 50, never)).toBe('water-front');
    expect(pickSheet(WATER, 'cymbal', 80, 20, never)).toBe('water-cymbal');
  });
  it('경계: 비율 0.85 이상이면 정면', () => {
    expect(pickSheet(WATER, 'drum', 100, 85, never)).toBe('water-front');
    expect(pickSheet(WATER, 'drum', 100, 84, () => 0.1)).toBe('water-side-a');
  });
  it('실물 킷의 헤드 비율(0.57~0.73)은 옆 그림, 실물 킥(0.89)은 정면', () => {
    expect(pickSheet(WATER, 'drum', 77.1, 54.6, () => 0.1)).toBe('water-side-a');
    expect(pickSheet(WATER, 'cymbal', 67.2, 38.3, never)).toBe('water-cymbal');
    expect(pickSheet(WATER, 'drum', 60.6, 53.8, never)).toBe('water-front');
  });
  it('옆 드럼은 난수로 a/b', () => {
    expect(pickSheet(WATER, 'drum', 70, 24, () => 0.2)).toBe('water-side-a');
    expect(pickSheet(WATER, 'drum', 70, 24, () => 0.8)).toBe('water-side-b');
  });
  it('페달은 그림 없음, 빈 목록도 없음', () => {
    expect(pickSheet(WATER, 'pedal', 30, 30, never)).toBeNull();
    expect(pickSheet([], 'drum', 70, 24, () => 0.1)).toBeNull();
  });
});
