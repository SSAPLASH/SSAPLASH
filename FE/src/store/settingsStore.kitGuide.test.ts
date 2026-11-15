import { describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

describe('kitGuide 설정 (자유 연습 키트 가이드, MODE-002)', () => {
  it('설정 버전은 27, 기본값은 켬', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().kitGuide).toBe(true);
  });

  it('setter로 끄고 켠다', () => {
    useSettings.getState().setKitGuide(false);
    expect(useSettings.getState().kitGuide).toBe(false);
    useSettings.getState().setKitGuide(true);
    expect(useSettings.getState().kitGuide).toBe(true);
  });

  it('v23 저장값 → v24에서 true로 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 23) as unknown as Record<string, unknown>;
    expect(out.kitGuide).toBe(true);
    expect(out.volume).toBe(0.5);
  });

  it('boolean이 아닌 값은 true, v24 이상 저장값은 그대로', () => {
    expect((migrateSettings({ kitGuide: 'x' }, 23) as unknown as Record<string, unknown>).kitGuide).toBe(true);
    expect((migrateSettings({ kitGuide: false }, 23) as unknown as Record<string, unknown>).kitGuide).toBe(false);
    expect((migrateSettings({ kitGuide: false }, 24) as unknown as Record<string, unknown>).kitGuide).toBe(false);
  });
});
