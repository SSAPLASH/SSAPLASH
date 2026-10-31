import { describe, expect, it } from 'vitest';
import { DOCK_NEEDS_READY_LABEL, dockPresetChipView, stickConnectionRequired } from './dockChip';

describe('stickConnectionRequired', () => {
  it('none은 불필요', () => {
    expect(stickConnectionRequired('none', false)).toBe(false);
    expect(stickConnectionRequired('none', true)).toBe(false);
  });
  it('usageGuide가 있으면 불필요', () => {
    expect(stickConnectionRequired('pointer', true)).toBe(false);
  });
  it('센서 + usageGuide 없음이면 필요', () => {
    expect(stickConnectionRequired('websocket', false)).toBe(true);
  });
});

describe('dockPresetChipView', () => {
  const base = { sensorKind: 'websocket' as const, hasUsageGuide: false, presetName: '기본 세팅' };

  it('양손 연결이면 프리셋 이름', () => {
    expect(dockPresetChipView({ ...base, connected: [true, true] })).toEqual({ kind: 'name', label: '기본 세팅' });
  });

  it('한 손이라도 끊기면 준비 필요 + hands', () => {
    expect(dockPresetChipView({ ...base, connected: [true, false] })).toEqual({
      kind: 'needsReady',
      label: DOCK_NEEDS_READY_LABEL,
      hands: [true, false],
    });
    expect(dockPresetChipView({ ...base, connected: [false, false] })).toMatchObject({ kind: 'needsReady', hands: [false, false] });
  });

  it('키보드 전용·usageGuide 소스는 미연결이어도 이름', () => {
    expect(dockPresetChipView({ ...base, sensorKind: 'none', connected: [false, false] }).kind).toBe('name');
    expect(dockPresetChipView({ ...base, hasUsageGuide: true, connected: [false, false] }).kind).toBe('name');
  });
});
