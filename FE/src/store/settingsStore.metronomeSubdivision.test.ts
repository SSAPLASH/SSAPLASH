import { describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

describe('metronomeSubdivision 설정 (메트로놈 박 분할, MODE-002·MODE-003)', () => {
  it('설정 버전은 27, 기본값은 자동', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().metronomeSubdivision).toBe('auto');
  });

  it('setter로 바꾼다', () => {
    useSettings.getState().setMetronomeSubdivision('eighth');
    expect(useSettings.getState().metronomeSubdivision).toBe('eighth');
    useSettings.getState().setMetronomeSubdivision('auto');
    expect(useSettings.getState().metronomeSubdivision).toBe('auto');
  });

  it('v25 저장값 → v26에서 자동으로 채우고 다른 값은 그대로 둔다', () => {
    const out = migrateSettings({ volume: 0.5, metronome: false, metronomeBpm: 96 }, 25) as unknown as Record<string, unknown>;
    expect(out.metronomeSubdivision).toBe('auto');
    expect(out).toMatchObject({ volume: 0.5, metronome: false, metronomeBpm: 96 });
  });

  it('세 값이 아니면 자동, v26 이상 저장값은 그대로', () => {
    expect((migrateSettings({ metronomeSubdivision: 'x' }, 25) as unknown as Record<string, unknown>).metronomeSubdivision).toBe('auto');
    expect((migrateSettings({ metronomeSubdivision: 'eighth' }, 25) as unknown as Record<string, unknown>).metronomeSubdivision).toBe('eighth');
    expect((migrateSettings({ metronomeSubdivision: 'quarter' }, 26) as unknown as Record<string, unknown>).metronomeSubdivision).toBe('quarter');
  });
});
