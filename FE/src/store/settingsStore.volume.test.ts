import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, migrateSettings, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;

describe('drumVolume·songVolume', () => {
  beforeEach(() => {
    useSettings.getState().setDrumVolume(1);
    useSettings.getState().setSongVolume(1);
  });

  it('기본값은 둘 다 1', () => {
    expect(useSettings.getInitialState().drumVolume).toBe(1);
    expect(useSettings.getInitialState().songVolume).toBe(1);
  });

  it('setDrumVolume은 0~2로 자르고 비정상 값은 1', () => {
    const { setDrumVolume } = useSettings.getState();
    setDrumVolume(1.5);
    expect(useSettings.getState().drumVolume).toBe(1.5);
    setDrumVolume(-1);
    expect(useSettings.getState().drumVolume).toBe(0);
    setDrumVolume(5);
    expect(useSettings.getState().drumVolume).toBe(2);
    setDrumVolume(0.3);
    setDrumVolume(Number.NaN);
    expect(useSettings.getState().drumVolume).toBe(1);
  });

  it('setSongVolume은 0~1로 자르고 비정상 값은 1', () => {
    const { setSongVolume } = useSettings.getState();
    setSongVolume(0.4);
    expect(useSettings.getState().songVolume).toBe(0.4);
    setSongVolume(-1);
    expect(useSettings.getState().songVolume).toBe(0);
    setSongVolume(3);
    expect(useSettings.getState().songVolume).toBe(1);
    setSongVolume(0.3);
    setSongVolume(Number.NaN);
    expect(useSettings.getState().songVolume).toBe(1);
  });

  it('설정 버전은 27', () => {
    expect(SETTINGS_VERSION).toBe(27);
  });

  it('v14 저장값 → v15에서 두 필드를 1로 채우고 나머지는 보존한다', () => {
    const out = migrateSettings({ volume: 0.5, metronomeVolume: 0.3, soundSetId: 'synth' }, 14) as unknown as Rec;
    expect(out.drumVolume).toBe(1);
    expect(out.songVolume).toBe(1);
    expect(out.volume).toBe(0.5);
    expect(out.metronomeVolume).toBe(0.3);
    expect(out.soundSetId).toBe('synth');
  });

  it('v15 이상 저장값의 음량은 건드리지 않는다', () => {
    const out = migrateSettings({ drumVolume: 1.6, songVolume: 0.2 }, 15) as unknown as Rec;
    expect(out.drumVolume).toBe(1.6);
    expect(out.songVolume).toBe(0.2);
  });

  it('v14 저장값에 범위 밖·비숫자 값이 있으면 자르거나 1', () => {
    const out = migrateSettings({ drumVolume: 9, songVolume: 'x' }, 14) as unknown as Rec;
    expect(out.drumVolume).toBe(2);
    expect(out.songVolume).toBe(1);
  });
});
