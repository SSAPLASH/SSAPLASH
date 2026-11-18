// @vitest-environment happy-dom
// 폐기된 옛 키(testVelocity·gameView)가 저장분에 남아 있어도 불러온 상태에 섞이지 않는다. 설정 버전은 올리지 않는다.
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, useSettings } from './settingsStore';

afterEach(() => {
  localStorage.clear();
});

describe('폐기된 옛 키 (testVelocity·gameView)', () => {
  it('저장분에 남아 있어도 상태에 섞이지 않고 나머지 값은 그대로 읽는다', async () => {
    localStorage.setItem('ssaplash.settings', JSON.stringify({ state: { volume: 0.4, testVelocity: 120, gameView: 'kit' }, version: SETTINGS_VERSION }));
    await useSettings.persist.rehydrate();
    const s = useSettings.getState() as unknown as Record<string, unknown>;
    expect(s.volume).toBe(0.4);
    expect('testVelocity' in s).toBe(false);
    expect('gameView' in s).toBe(false);
  });
});
