import { describe, expect, it } from 'vitest';
import { isMiniPath, MINI_GAME_IDS, MINI_GAME_PARAM, MINI_PATH, miniGameOfPath, miniGamePath, miniListPath, parseMiniGameId } from './miniGame';

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

describe('miniGamePath: tempo', () => {
  it('인간 메트로놈 경로', () => {
    expect(miniGamePath('tempo')).toBe('/play/mini/tempo');
  });
});

describe('miniGamePath: crescendo', () => {
  it('어디까지 올라가는 거예요? 경로', () => {
    expect(miniGamePath('crescendo')).toBe('/play/mini/crescendo');
  });

  it('그 경로도 미니게임 경로다', () => {
    expect(isMiniPath('/play/mini/crescendo')).toBe(true);
  });
});

describe('miniGamePath: oneshot', () => {
  it('정적 뒤 한 방 경로', () => {
    expect(miniGamePath('oneshot')).toBe('/play/mini/oneshot');
  });
});

describe('parseMiniGameId', () => {
  it('게임 id면 그대로 돌려준다', () => {
    for (const id of MINI_GAME_IDS) expect(parseMiniGameId(id)).toBe(id);
  });

  it('모르는 값·빈 값·null이면 null', () => {
    expect(parseMiniGameId('ghost')).toBeNull();
    expect(parseMiniGameId('Speed')).toBeNull();
    expect(parseMiniGameId('')).toBeNull();
    expect(parseMiniGameId(null)).toBeNull();
    expect(parseMiniGameId(undefined)).toBeNull();
  });
});

describe('miniListPath', () => {
  it('게임 id를 넘기면 그 게임을 고른 목록 주소', () => {
    expect(MINI_GAME_PARAM).toBe('game');
    expect(miniListPath('tempo')).toBe('/play/mini?game=tempo');
    expect(miniListPath('oneshot')).toBe('/play/mini?game=oneshot');
  });

  it('넘기지 않거나 null이면 주소 값 없는 목록', () => {
    expect(miniListPath()).toBe('/play/mini');
    expect(miniListPath(null)).toBe('/play/mini');
  });
});

describe('miniGameOfPath', () => {
  it('게임 화면 경로에서 게임 id를 읽는다', () => {
    expect(miniGameOfPath('/play/mini/speed')).toBe('speed');
    expect(miniGameOfPath('/play/mini/sight')).toBe('sight');
    expect(miniGameOfPath('/play/mini/tempo/')).toBe('tempo');
  });

  it('목록·모르는 게임·다른 경로면 null', () => {
    expect(miniGameOfPath('/play/mini')).toBeNull();
    expect(miniGameOfPath('/play/mini/')).toBeNull();
    expect(miniGameOfPath('/play/mini/ghost')).toBeNull();
    expect(miniGameOfPath('/play')).toBeNull();
    expect(miniGameOfPath('/play/minimal/speed')).toBeNull();
  });
});
