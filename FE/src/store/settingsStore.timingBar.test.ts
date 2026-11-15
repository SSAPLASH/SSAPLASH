import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;

describe('timingBar', () => {
  beforeEach(() => {
    useSettings.getState().setTimingBar(true);
  });

  it('설정 버전은 27, 기본값은 켬', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().timingBar).toBe(true);
  });

  it('setTimingBar로 켜고 끈다', () => {
    useSettings.getState().setTimingBar(false);
    expect(useSettings.getState().timingBar).toBe(false);
    useSettings.getState().setTimingBar(true);
    expect(useSettings.getState().timingBar).toBe(true);
  });

  it('v19 저장값 → true로 채우고 다른 필드는 보존한다', () => {
    const out = migrateSettings({ hitFxTheme: 'water', liveCoach: false }, 19) as unknown as Rec;
    expect(out.timingBar).toBe(true);
    expect(out.hitFxTheme).toBe('water');
    expect(out.liveCoach).toBe(false);
  });

  it('boolean이 아닌 값은 true, boolean은 보존', () => {
    expect((migrateSettings({ timingBar: 'x' }, 19) as unknown as Rec).timingBar).toBe(true);
    expect((migrateSettings({ timingBar: false }, 19) as unknown as Rec).timingBar).toBe(false);
  });

  it('v20 저장값은 건드리지 않는다', () => {
    expect((migrateSettings({ timingBar: false }, 20) as unknown as Rec).timingBar).toBe(false);
  });
});
