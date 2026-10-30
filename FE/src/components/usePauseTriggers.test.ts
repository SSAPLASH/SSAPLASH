import { describe, expect, it } from 'vitest';
import { handDropped } from './usePauseTriggers';

describe('handDropped', () => {
  it('한 손만 끊겨도 참', () => {
    expect(handDropped([true, true], [true, false])).toBe(true);
    expect(handDropped([true, true], [false, true])).toBe(true);
    expect(handDropped([true, true], [false, false])).toBe(true);
  });
  it('끊김 전이가 없으면 거짓(새로 붙거나 그대로)', () => {
    expect(handDropped([false, false], [true, false])).toBe(false);
    expect(handDropped([true, false], [true, false])).toBe(false);
    expect(handDropped([false, true], [true, true])).toBe(false);
  });
});
