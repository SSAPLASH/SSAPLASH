import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;

describe('hitFxTheme', () => {
  beforeEach(() => {
    useSettings.getState().setHitFxTheme('auto');
  });

  it('설정 버전은 27, 기본값은 auto', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().hitFxTheme).toBe('auto');
  });

  it('setHitFxTheme은 출시 테마를 받고 모르는 값은 무시한다', () => {
    const { setHitFxTheme } = useSettings.getState();
    setHitFxTheme('electric');
    expect(useSettings.getState().hitFxTheme).toBe('electric');
    setHitFxTheme('water');
    expect(useSettings.getState().hitFxTheme).toBe('water');
    setHitFxTheme('weird' as never);
    expect(useSettings.getState().hitFxTheme).toBe('water');
  });

  it('v18 저장값 → auto로 채우고 다른 필드는 보존한다', () => {
    const out = migrateSettings({ kitSkin: 'neon', drumVolume: 1.4 }, 18) as unknown as Rec;
    expect(out.hitFxTheme).toBe('auto');
    expect(out.kitSkin).toBe('neon');
    expect(out.drumVolume).toBe(1.4);
  });

  it('모르는 값·숫자는 auto, 아는 값은 보존', () => {
    expect((migrateSettings({ hitFxTheme: 'weird' }, 18) as unknown as Rec).hitFxTheme).toBe('auto');
    expect((migrateSettings({ hitFxTheme: 42 }, 18) as unknown as Rec).hitFxTheme).toBe('auto');
    expect((migrateSettings({ hitFxTheme: 'water' }, 18) as unknown as Rec).hitFxTheme).toBe('water');
  });

  it('v19 이상 저장값은 건드리지 않는다', () => {
    expect((migrateSettings({ hitFxTheme: 'electric' }, 19) as unknown as Rec).hitFxTheme).toBe('electric');
  });
});
