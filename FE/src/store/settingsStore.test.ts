import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, migrateSettings } from './settingsStore';

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
