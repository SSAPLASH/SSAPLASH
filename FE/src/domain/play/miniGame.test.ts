import { describe, expect, it } from 'vitest';
import { isMiniPath, MINI_PATH, miniGamePath } from './miniGame';

describe('miniGamePath', () => {
  it('목록 경로 아래에 게임 id를 붙인다', () => {
    expect(MINI_PATH).toBe('/play/mini');
    expect(miniGamePath('speed')).toBe('/play/mini/speed');
    expect(miniGamePath('dynamics')).toBe('/play/mini/dynamics');
  });
});

describe('isMiniPath', () => {
  it('목록 경로와 그 아래 경로는 참', () => {
    expect(isMiniPath('/play/mini')).toBe(true);
    expect(isMiniPath('/play/mini/speed')).toBe(true);
    expect(isMiniPath('/play/mini/dynamics')).toBe(true);
    expect(isMiniPath('/play/mini/speed/result')).toBe(true);
  });

  it('비슷하지만 다른 경로는 거짓', () => {
    expect(isMiniPath('/play')).toBe(false);
    expect(isMiniPath('/play/minimal')).toBe(false);
    expect(isMiniPath('/play/mini-x')).toBe(false);
    expect(isMiniPath('/studio')).toBe(false);
    expect(isMiniPath('')).toBe(false);
  });
});

describe('miniGamePath: sight', () => {
  it('악보 보고 빨리 치기 경로', () => {
    expect(miniGamePath('sight')).toBe('/play/mini/sight');
  });
});
