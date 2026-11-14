import { describe, expect, it } from 'vitest';
import { migrateSettings, useSettings } from './settingsStore';

describe('accompaniment 설정', () => {
  it('기본값은 끔(반주를 끄면 연습 속도를 고를 수 있다, MODE-003)', () => {
    expect(useSettings.getInitialState().accompaniment).toBe(false);
  });

  it('setter로 켜고 끈다', () => {
    useSettings.getState().setAccompaniment(true);
    expect(useSettings.getState().accompaniment).toBe(true);
    useSettings.getState().setAccompaniment(false);
    expect(useSettings.getState().accompaniment).toBe(false);
  });

  it('v26까지의 저장값은 v27에서 한 번 끔으로 되돌린다(다른 값은 그대로)', () => {
    for (const from of [20, 21, 22, 26]) {
      const out = migrateSettings({ volume: 0.5, accompaniment: true }, from) as unknown as Record<string, unknown>;
      expect(out.accompaniment).toBe(false);
      expect(out.volume).toBe(0.5);
    }
    expect((migrateSettings({ accompaniment: 'x' }, 20) as unknown as Record<string, unknown>).accompaniment).toBe(false);
  });

  it('v27 이상에서 켠 값은 그대로 남는다', () => {
    expect((migrateSettings({ accompaniment: true }, 27) as unknown as Record<string, unknown>).accompaniment).toBe(true);
  });
});
