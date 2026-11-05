import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettings, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;

describe('kitSkin', () => {
  beforeEach(() => {
    useSettings.getState().setKitSkin('acoustic');
  });

  it('기본값은 acoustic', () => {
    expect(useSettings.getInitialState().kitSkin).toBe('acoustic');
  });

  it('setKitSkin은 세 스킨을 받고 모르는 값은 무시한다', () => {
    const { setKitSkin } = useSettings.getState();
    setKitSkin('neon');
    expect(useSettings.getState().kitSkin).toBe('neon');
    setKitSkin('electronic');
    expect(useSettings.getState().kitSkin).toBe('electronic');
    setKitSkin('weird' as never);
    expect(useSettings.getState().kitSkin).toBe('electronic');
  });

  it('v15 저장값 → v16에서 값이 없으면 acoustic, 다른 필드는 보존한다', () => {
    const out = migrateSettings({ drumVolume: 1.4, soundSetId: 'synth' }, 15) as unknown as Rec;
    expect(out.kitSkin).toBe('acoustic');
    expect(out.drumVolume).toBe(1.4);
    expect(out.soundSetId).toBe('synth');
  });

  it('모르는 값은 acoustic, neon은 보존', () => {
    expect((migrateSettings({ kitSkin: 'weird' }, 15) as unknown as Rec).kitSkin).toBe('acoustic');
    expect((migrateSettings({ kitSkin: 42 }, 15) as unknown as Rec).kitSkin).toBe('acoustic');
    expect((migrateSettings({ kitSkin: 'neon' }, 15) as unknown as Rec).kitSkin).toBe('neon');
  });

  it('v16 이상 저장값은 건드리지 않는다', () => {
    expect((migrateSettings({ kitSkin: 'electronic' }, 16) as unknown as Rec).kitSkin).toBe('electronic');
  });
});
