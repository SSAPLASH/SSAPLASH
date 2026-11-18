import { describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

describe('gameGuide 설정 (리듬 게임 가이드, MODE-001)', () => {
  it('설정 버전은 27, 기본값은 끔', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().gameGuide).toBe(false);
  });

  it('setter로 켜고 끈다', () => {
    useSettings.getState().setGameGuide(true);
    expect(useSettings.getState().gameGuide).toBe(true);
    useSettings.getState().setGameGuide(false);
    expect(useSettings.getState().gameGuide).toBe(false);
  });

  it('v24 저장값 → v25에서 false로 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 24) as unknown as Record<string, unknown>;
    expect(out.gameGuide).toBe(false);
    expect(out.volume).toBe(0.5);
  });

  it('boolean이 아닌 값은 false, v25 이상 저장값은 그대로', () => {
    expect((migrateSettings({ gameGuide: 'x' }, 24) as unknown as Record<string, unknown>).gameGuide).toBe(false);
    expect((migrateSettings({ gameGuide: true }, 24) as unknown as Record<string, unknown>).gameGuide).toBe(true);
    expect((migrateSettings({ gameGuide: true }, 25) as unknown as Record<string, unknown>).gameGuide).toBe(true);
  });
});
