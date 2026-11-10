import { describe, expect, it } from 'vitest';
import { migrateSettings, SETTINGS_VERSION, useSettings } from './settingsStore';

type Rec = Record<string, unknown>;
const run = (countInBars: unknown, version = 20) => (migrateSettings({ countInBars }, version) as unknown as Rec).countInBars;

describe('countInBars (시작 전 마디, MODE-001)', () => {
  it('설정 버전은 21, 기본값은 2', () => {
    expect(SETTINGS_VERSION).toBe(21);
    expect(useSettings.getInitialState().countInBars).toBe(2);
  });

  it('v20 저장값 1은 2로 올리고 0·2·3은 보존한다', () => {
    expect(run(1)).toBe(2);
    expect(run(0)).toBe(0);
    expect(run(2)).toBe(2);
    expect(run(3)).toBe(3);
  });

  it('0~3 정수가 아니면 2', () => {
    expect(run(4)).toBe(2);
    expect(run(-1)).toBe(2);
    expect(run(1.5)).toBe(2);
    expect(run('1')).toBe(2);
    expect(run(undefined)).toBe(2);
    expect(run(Number.NaN)).toBe(2);
  });

  it('v21 저장값은 건드리지 않는다', () => {
    expect(run(1, 21)).toBe(1);
  });
});
