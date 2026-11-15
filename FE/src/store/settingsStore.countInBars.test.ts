import { describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;
const run = (countInBars: unknown, version = 20) => (migrateSettings({ countInBars }, version) as unknown as Rec).countInBars;

describe('countInBars (카운트다운 끔·켬, MODE-001)', () => {
  it('설정 버전은 27, 기본값은 1(켬)', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().countInBars).toBe(1);
  });

  it('v20 저장값 0은 0(끔), 1·2는 1(켬)', () => {
    expect(run(0)).toBe(0);
    expect(run(1)).toBe(1);
    expect(run(2)).toBe(1);
  });

  it('모르는 값은 1', () => {
    expect(run(3)).toBe(1);
    expect(run(-1)).toBe(1);
    expect(run('0')).toBe(1);
    expect(run(undefined)).toBe(1);
    expect(run(Number.NaN)).toBe(1);
  });

  it('v21 저장값은 건드리지 않는다', () => {
    expect(run(2, 21)).toBe(2);
  });
});
