import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettings, useSettings } from './settingsStore';

describe('metronomeVolume', () => {
  beforeEach(() => useSettings.getState().setMetronomeVolume(1));

  it('기본값은 1', () => {
    expect(useSettings.getState().metronomeVolume).toBe(1);
  });

  it('setter는 0~1로 클램프하고 비정상 값은 1', () => {
    const { setMetronomeVolume } = useSettings.getState();
    setMetronomeVolume(0.4);
    expect(useSettings.getState().metronomeVolume).toBe(0.4);
    setMetronomeVolume(-3);
    expect(useSettings.getState().metronomeVolume).toBe(0);
    setMetronomeVolume(7);
    expect(useSettings.getState().metronomeVolume).toBe(1);
    setMetronomeVolume(0.3);
    setMetronomeVolume(Number.NaN);
    expect(useSettings.getState().metronomeVolume).toBe(1);
  });

  it('v12 저장값 → v13에서 1로 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 12) as unknown as Record<string, unknown>;
    expect(out.metronomeVolume).toBe(1);
    expect(out.volume).toBe(0.5);
  });

  it('v13 이상 저장값의 음량은 건드리지 않는다', () => {
    const out = migrateSettings({ metronomeVolume: 0.25 }, 13) as unknown as Record<string, unknown>;
    expect(out.metronomeVolume).toBe(0.25);
  });

  it('v12 저장값에 범위 밖·비숫자 음량이 있어도 1', () => {
    expect((migrateSettings({ metronomeVolume: 5 }, 12) as unknown as Record<string, unknown>).metronomeVolume).toBe(1);
    expect((migrateSettings({ metronomeVolume: 'x' }, 12) as unknown as Record<string, unknown>).metronomeVolume).toBe(1);
  });
});
