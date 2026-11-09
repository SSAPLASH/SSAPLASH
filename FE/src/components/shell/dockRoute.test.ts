// Dock은 연주 화면(자유 모드·리듬게임·악보 연습)에서만 보인다(QA 352)
import { describe, expect, it } from 'vitest';
import { dockVisible } from './dockRoute';

describe('dockVisible', () => {
  it('연주 화면에서만 참이다', () => {
    expect(dockVisible('/free')).toBe(true);
    expect(dockVisible('/play')).toBe(true);
    expect(dockVisible('/sheet')).toBe(true);
  });

  it('그 밖의 화면과 접두사만 같은 경로는 거짓이다', () => {
    for (const p of ['/', '/studio', '/history', '/settings', '/setup', '/result/1', '/monitor/stick', '/free/x', '/sheets']) {
      expect(dockVisible(p)).toBe(false);
    }
  });
});
