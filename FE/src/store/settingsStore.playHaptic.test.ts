// @vitest-environment happy-dom
// 연주 중 타격 진동 방식(PLAY-006): 기본 판정 진동, 저장분에 없거나 모르는 값이면 판정 진동. 설정 버전은 올리지 않는다.
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, useSettings } from './settingsStore';

const KEY = 'ssaplash.settings';

/** 저장분을 넣고 다시 읽어 들인 뒤의 playHaptic */
async function rehydrateWith(persisted: Record<string, unknown>): Promise<string> {
  localStorage.setItem(KEY, JSON.stringify({ state: persisted, version: SETTINGS_VERSION }));
  await useSettings.persist.rehydrate();
  return useSettings.getState().playHaptic;
}

afterEach(() => {
  localStorage.clear();
  useSettings.getState().setPlayHaptic('judgement');
});

describe('playHaptic 설정', () => {
  it('기본값은 판정 진동이고 설정 버전은 그대로 27', () => {
    expect(useSettings.getInitialState().playHaptic).toBe('judgement');
    expect(SETTINGS_VERSION).toBe(27);
  });

  it('setter로 바꾼다', () => {
    useSettings.getState().setPlayHaptic('local');
    expect(useSettings.getState().playHaptic).toBe('local');
  });

  it('저장분에 없으면 판정 진동', async () => {
    expect(await rehydrateWith({ volume: 0.5 })).toBe('judgement');
  });

  it('모르는 값이면 판정 진동, local은 그대로', async () => {
    expect(await rehydrateWith({ playHaptic: 'both' })).toBe('judgement');
    expect(await rehydrateWith({ playHaptic: 'local' })).toBe('local');
  });
});
