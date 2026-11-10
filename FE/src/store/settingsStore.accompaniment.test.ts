import { describe, expect, it } from 'vitest';
import { migrateSettings, useSettings } from './settingsStore';

describe('accompaniment 설정', () => {
  it('기본값은 켬', () => {
    expect(useSettings.getState().accompaniment).toBe(true);
  });

  it('setter로 끄고 켠다', () => {
    useSettings.getState().setAccompaniment(false);
    expect(useSettings.getState().accompaniment).toBe(false);
    useSettings.getState().setAccompaniment(true);
    expect(useSettings.getState().accompaniment).toBe(true);
  });

  it('v21 저장값 → v22에서 true로 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 21) as unknown as Record<string, unknown>;
    expect(out.accompaniment).toBe(true);
    expect(out.volume).toBe(0.5);
  });

  it('boolean이 아닌 값은 true, v22 이상 저장값은 그대로', () => {
    expect((migrateSettings({ accompaniment: 'x' }, 20) as unknown as Record<string, unknown>).accompaniment).toBe(true);
    expect((migrateSettings({ accompaniment: false }, 22) as unknown as Record<string, unknown>).accompaniment).toBe(false);
  });
});
