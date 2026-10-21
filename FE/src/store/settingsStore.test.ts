import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, migrateSettings, useSettings } from './settingsStore';
import { KIT_LAYOUT_PRESETS } from '@/domain/kitLayout';
import { DEFAULT_SENSOR_TUNING } from '@/domain/tuning';

describe('migrateSettings', () => {
  it('v2: pointerHitKeys·wsUrl을 sensorOptions로 옮기고 옛 필드를 지운다', () => {
    const v2 = {
      sensorKind: 'pointer',
      pointerHitKeys: { left: 'KeyA', right: 'KeyL' },
      wsUrl: 'ws://192.168.0.5:9000',
      volume: 0.5,
    };
    const out = migrateSettings(v2, 2) as unknown as Record<string, unknown>;
    expect(out.sensorOptions).toEqual({
      pointer: { leftHitKey: 'KeyA', rightHitKey: 'KeyL' },
      websocket: { url: 'ws://192.168.0.5:9000' },
    });
    expect('pointerHitKeys' in out).toBe(false);
    expect('wsUrl' in out).toBe(false);
    // 무관한 필드는 그대로
    expect(out.sensorKind).toBe('pointer');
    expect(out.volume).toBe(0.5);
  });

  it('v2에 한쪽 필드만 있어도 있는 것만 옮긴다', () => {
    const out = migrateSettings({ sensorKind: 'none', wsUrl: 'ws://x' }, 2) as unknown as Record<string, unknown>;
    expect(out.sensorOptions).toEqual({ websocket: { url: 'ws://x' } });
  });

  it('v1: inputKind → sensorKind → sensorOptions까지 한 번에 이행', () => {
    const out = migrateSettings(
      { inputKind: 'websocket', pointerHitKeys: { left: 'KeyF', right: 'KeyJ' }, wsUrl: 'ws://y' },
      1,
    ) as unknown as Record<string, unknown>;
    expect(out.sensorKind).toBe('websocket');
    expect('inputKind' in out).toBe(false);
    expect(out.sensorOptions).toEqual({
      pointer: { leftHitKey: 'KeyF', rightHitKey: 'KeyJ' },
      websocket: { url: 'ws://y' },
    });
  });

  it('v1: 알 수 없는 inputKind(keyboard 등)는 none', () => {
    const out = migrateSettings({ inputKind: 'keyboard' }, 1) as unknown as Record<string, unknown>;
    expect(out.sensorKind).toBe('none');
  });

  it('알 수 없는 sensorKind는 이행에서 건드리지 않는다(R6은 bootstrap이 레지스트리로 처리)', () => {
    const out = migrateSettings({ sensorKind: 'removed-source', sensorOptions: {} }, 3);
    expect(out.sensorKind).toBe('removed-source');
  });

  it('현재 버전 상태는 그대로 통과하고, 기존 sensorOptions를 덮어쓰지 않는다', () => {
    const state = { sensorKind: 'ble', sensorOptions: { pointer: { leftHitKey: 'KeyQ' } } };
    expect(migrateSettings(state, SETTINGS_VERSION)).toEqual(state);
    // v2 이행 시 이미 있던 sensorOptions 항목은 보존
    const out = migrateSettings({ sensorOptions: { fake: { a: 1 } }, wsUrl: 'ws://z' }, 2) as unknown as Record<string, unknown>;
    expect(out.sensorOptions).toEqual({ fake: { a: 1 }, websocket: { url: 'ws://z' } });
  });
});

describe('migrateSettings v3 → v4 (튜닝)', () => {
  it('최상위 maxRadiusDeg를 tuning.maxRadiusDeg로 옮기고 옛 필드를 지운다', () => {
    const out = migrateSettings({ sensorKind: 'pointer', maxRadiusDeg: 30, volume: 0.4 }, 3) as unknown as Record<string, unknown>;
    expect(out.tuning).toEqual({ ...DEFAULT_SENSOR_TUNING, maxRadiusDeg: 30 });
    expect('maxRadiusDeg' in out).toBe(false);
    expect(out.sensorKind).toBe('pointer');
    expect(out.volume).toBe(0.4);
  });

  it('maxRadiusDeg가 없으면 기본 튜닝', () => {
    const out = migrateSettings({ sensorKind: 'none' }, 3) as unknown as Record<string, unknown>;
    expect(out.tuning).toEqual(DEFAULT_SENSOR_TUNING);
  });

  it('범위 밖 저장값은 슬라이더 범위로 자른다', () => {
    const out = migrateSettings({ maxRadiusDeg: 999 }, 3) as unknown as { tuning: { maxRadiusDeg: number } };
    expect(out.tuning.maxRadiusDeg).toBe(40);
  });

  it('v2 이하에서도 v4까지 한 번에 이행', () => {
    const out = migrateSettings({ inputKind: 'pointer', maxRadiusDeg: 15 }, 1) as unknown as Record<string, unknown>;
    expect(out.sensorKind).toBe('pointer');
    expect(out.tuning).toEqual({ ...DEFAULT_SENSOR_TUNING, maxRadiusDeg: 15 });
    expect('maxRadiusDeg' in out).toBe(false);
  });
});

describe('migrateSettings v4 → v5 (사운드 세트)', () => {
  it('soundSetId·testVelocity 기본값을 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 4) as unknown as Record<string, unknown>;
    expect(out.soundSetId).toBe('ssaplash');
    expect(out.testVelocity).toBe(96);
    expect(out.volume).toBe(0.5);
  });

  it('이미 유효한 값은 보존한다', () => {
    const out = migrateSettings({ soundSetId: 'synth', testVelocity: 120 }, 4) as unknown as Record<string, unknown>;
    expect(out.soundSetId).toBe('synth');
    expect(out.testVelocity).toBe(120);
  });
});

describe('migrateSettings v5 → v6 (게임 뷰)', () => {
  it('gameView 기본값 highway를 채운다', () => {
    const out = migrateSettings({ volume: 0.5 }, 5) as unknown as Record<string, unknown>;
    expect(out.gameView).toBe('highway');
    expect(out.volume).toBe(0.5);
  });

  it('유효한 값은 보존하고 잘못된 값은 highway', () => {
    expect((migrateSettings({ gameView: 'kit' }, 5) as unknown as Record<string, unknown>).gameView).toBe('kit');
    expect((migrateSettings({ gameView: 'xx' }, 5) as unknown as Record<string, unknown>).gameView).toBe('highway');
  });

  it('v1에서도 v6까지 한 번에 이행', () => {
    expect((migrateSettings({}, 1) as unknown as Record<string, unknown>).gameView).toBe('highway');
  });
});

describe('레이아웃 프리셋', () => {
  it('applyLayoutPreset은 kitLayout을 프리셋으로 바꾼다', () => {
    useSettings.getState().applyLayoutPreset('wide');
    expect(useSettings.getState().kitLayout).toEqual(KIT_LAYOUT_PRESETS.wide);
    useSettings.getState().resetLayout();
    expect(useSettings.getState().kitLayout).toEqual(KIT_LAYOUT_PRESETS.basic);
  });
});
