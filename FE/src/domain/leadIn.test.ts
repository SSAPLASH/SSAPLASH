import { describe, expect, it } from 'vitest';
import { isLeadInBlank, leadInCount } from './leadIn';

// 4/4, 박 500ms → 1마디 2000ms
const B = 500;

describe('leadInCount', () => {
  it('마지막 마디에서 박마다 4·3·2·1', () => {
    expect(leadInCount(-2000, B, 4)).toBe(4);
    expect(leadInCount(-1999, B, 4)).toBe(4);
    expect(leadInCount(-1501, B, 4)).toBe(4);
    expect(leadInCount(-1500, B, 4)).toBe(3);
    expect(leadInCount(-1001, B, 4)).toBe(3);
    expect(leadInCount(-1000, B, 4)).toBe(2);
    expect(leadInCount(-501, B, 4)).toBe(2);
    expect(leadInCount(-500, B, 4)).toBe(1);
    expect(leadInCount(-1, B, 4)).toBe(1);
  });
  it('0 이상이면 null', () => {
    expect(leadInCount(0, B, 4)).toBeNull();
    expect(leadInCount(10, B, 4)).toBeNull();
  });
  it('마지막 마디보다 앞(빈 마디·인트로)이면 null', () => {
    expect(leadInCount(-2001, B, 4)).toBeNull();
    expect(leadInCount(-4000, B, 4)).toBeNull();
  });
  it('3/4는 3·2·1', () => {
    expect(leadInCount(-1500, B, 3)).toBe(3);
    expect(leadInCount(-1000, B, 3)).toBe(2);
    expect(leadInCount(-500, B, 3)).toBe(1);
    expect(leadInCount(-1501, B, 3)).toBeNull();
  });
  it('부동소수 박 길이에서도 박 경계에서 어긋나지 않는다', () => {
    const beat = 60_000 / 140;
    expect(leadInCount(-beat * 4, beat, 4)).toBe(4);
    expect(leadInCount(-beat * 3, beat, 4)).toBe(3);
    expect(leadInCount(-beat, beat, 4)).toBe(1);
  });
});

describe('isLeadInBlank', () => {
  it('2마디: 앞 마디만 빈 마디', () => {
    expect(isLeadInBlank(-4000, B, 4, 2)).toBe(true);
    expect(isLeadInBlank(-2001, B, 4, 2)).toBe(true);
    expect(isLeadInBlank(-2000, B, 4, 2)).toBe(false);
    expect(isLeadInBlank(-1, B, 4, 2)).toBe(false);
    expect(isLeadInBlank(0, B, 4, 2)).toBe(false);
  });
  it('리드인 앞(긴 인트로)은 거짓', () => {
    expect(isLeadInBlank(-4001, B, 4, 2)).toBe(false);
  });
  it('마디 수 0·1이면 항상 거짓', () => {
    for (const g of [-6000, -3000, -2001, -1000, 0]) {
      expect(isLeadInBlank(g, B, 4, 0)).toBe(false);
      expect(isLeadInBlank(g, B, 4, 1)).toBe(false);
    }
  });
  it('3마디: 빈 마디 2개', () => {
    expect(isLeadInBlank(-6000, B, 4, 3)).toBe(true);
    expect(isLeadInBlank(-4000, B, 4, 3)).toBe(true);
    expect(isLeadInBlank(-2001, B, 4, 3)).toBe(true);
    expect(isLeadInBlank(-2000, B, 4, 3)).toBe(false);
    expect(isLeadInBlank(-6001, B, 4, 3)).toBe(false);
  });
  it('3/4, 2마디', () => {
    expect(isLeadInBlank(-3000, B, 3, 2)).toBe(true);
    expect(isLeadInBlank(-1501, B, 3, 2)).toBe(true);
    expect(isLeadInBlank(-1500, B, 3, 2)).toBe(false);
  });
});
