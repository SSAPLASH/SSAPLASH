import { describe, expect, it } from 'vitest';
import { stickConnectionRequired } from './dockChip';

describe('stickConnectionRequired', () => {
  it('none은 불필요', () => {
    expect(stickConnectionRequired('none', false)).toBe(false);
    expect(stickConnectionRequired('none', true)).toBe(false);
  });
  it('usageGuide가 있으면 불필요', () => {
    expect(stickConnectionRequired('pointer', true)).toBe(false);
  });
  it('센서 + usageGuide 없음이면 필요', () => {
    expect(stickConnectionRequired('websocket', false)).toBe(true);
  });
});
