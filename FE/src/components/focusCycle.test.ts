// 포커스 순환 계산 테스트
import { describe, expect, it } from 'vitest';
import { cycleIndex, initialFocusIndex, needsRefocus } from './focusCycle';

describe('cycleIndex', () => {
  it('요소가 없으면 -1', () => {
    expect(cycleIndex(0, -1, false)).toBe(-1);
    expect(cycleIndex(0, 0, true)).toBe(-1);
  });
  it('앞으로 이동하고 끝에서 처음으로 돈다', () => {
    expect(cycleIndex(3, 0, false)).toBe(1);
    expect(cycleIndex(3, 2, false)).toBe(0);
  });
  it('Shift면 뒤로 가고 처음에서 끝으로 돈다', () => {
    expect(cycleIndex(3, 1, true)).toBe(0);
    expect(cycleIndex(3, 0, true)).toBe(2);
  });
  it('현재가 없으면(-1) 앞으로는 처음, 뒤로는 끝', () => {
    expect(cycleIndex(3, -1, false)).toBe(0);
    expect(cycleIndex(3, -1, true)).toBe(2);
  });
});

describe('initialFocusIndex', () => {
  it('선호가 활성이면 선호', () => {
    expect(initialFocusIndex([true, true, true], 1)).toBe(1);
  });
  it('선호가 비활성이면 첫 활성', () => {
    expect(initialFocusIndex([false, false, true, true], 0)).toBe(2);
    expect(initialFocusIndex([true, true], null)).toBe(0);
  });
  it('전부 비활성이면 -1', () => {
    expect(initialFocusIndex([false, false], 0)).toBe(-1);
    expect(initialFocusIndex([], null)).toBe(-1);
  });
});

describe('needsRefocus', () => {
  it('안쪽 요소가 사라져 body로 떨어졌을 때만 true', () => {
    expect(needsRefocus(true, false, true)).toBe(true);
  });
  it('요소가 문서에 남아 있으면(스크림 클릭) false', () => {
    expect(needsRefocus(true, true, true)).toBe(false);
  });
  it('포커스가 다른 요소로 옮겨졌거나 안쪽에 없었으면 false', () => {
    expect(needsRefocus(true, false, false)).toBe(false);
    expect(needsRefocus(false, false, true)).toBe(false);
  });
});
