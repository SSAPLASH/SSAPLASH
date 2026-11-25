import { describe, expect, it } from 'vitest';
import { metronomeDisabledRoute } from './metronomeRoute';

describe('metronomeDisabledRoute', () => {
  it('/play와 인간 메트로놈 화면에서는 막는다', () => {
    expect(metronomeDisabledRoute('/play')).toBe(true);
    expect(metronomeDisabledRoute('/play/mini/tempo')).toBe(true);
  });

  it('다른 미니게임과 화면에서는 막지 않는다', () => {
    for (const path of ['/play/mini', '/play/mini/speed', '/play/mini/dynamics', '/play/mini/sight', '/sheet', '/free', '/']) {
      expect(metronomeDisabledRoute(path), path).toBe(false);
    }
  });

  it('정확히 같은 경로만 막는다(끝 슬래시·하위 경로는 아니다)', () => {
    expect(metronomeDisabledRoute('/play/')).toBe(false);
    expect(metronomeDisabledRoute('/play/mini/tempo/x')).toBe(false);
  });
});

describe('metronomeDisabledRoute: 정적 뒤 한 방', () => {
  it('/play/mini/oneshot에서는 막고 하위 경로는 막지 않는다', () => {
    expect(metronomeDisabledRoute('/play/mini/oneshot')).toBe(true);
    expect(metronomeDisabledRoute('/play/mini/oneshot/x')).toBe(false);
  });
});
