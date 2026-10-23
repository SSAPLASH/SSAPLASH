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

describe('migrateSettings v6 → v7 (메트로놈·사운드 토글)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 6) as unknown as Record<string, unknown>;

  it('없으면 기본값', () => {
    const out = run({ volume: 0.5 });
    expect(out.metronomeBpm).toBe(120);
    expect(out.metronomeBeatsPerBar).toBe(4);
    expect(out.soundOn).toBe(true);
    expect(out.volume).toBe(0.5);
  });

  it('범위 안 bpm·3박자·soundOn false는 유지', () => {
    const out = run({ metronomeBpm: 90, metronomeBeatsPerBar: 3, soundOn: false });
    expect(out).toMatchObject({ metronomeBpm: 90, metronomeBeatsPerBar: 3, soundOn: false });
  });

  it('범위 밖 bpm은 120', () => {
    expect(run({ metronomeBpm: 10 }).metronomeBpm).toBe(120);
    expect(run({ metronomeBpm: 500 }).metronomeBpm).toBe(120);
    expect(run({ metronomeBpm: 'x' }).metronomeBpm).toBe(120);
  });

  it('beatsPerBar가 3이 아니면 4', () => {
    expect(run({ metronomeBeatsPerBar: 5 }).metronomeBeatsPerBar).toBe(4);
  });

  it('soundOn이 boolean이 아니면 true', () => {
    expect(run({ soundOn: 'off' }).soundOn).toBe(true);
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

describe('migrateSettings v7 → v8 (키 매핑 폐기·프리셋 정리)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 7) as unknown as Record<string, unknown>;
  const layout = KIT_LAYOUT_PRESETS.basic;

  it('keyMap을 버리고 프리셋에서 keyMap·profile을 떼며 soundSetId를 채운다', () => {
    const out = run({
      keyMap: { KeyZ: { pad: 'SNARE', stickId: 0 } },
      soundSetId: 'synth',
      profile: { anchors: {} },
      presets: [
        { id: 'a', name: 'A', createdAt: 'x', layout, keyMap: { KeyZ: {} }, profile: { anchors: {} } },
        { id: 'b', name: 'B', createdAt: 'y', layout, keyMap: {}, profile: null, soundSetId: 'ssaplash' },
      ],
    });
    expect('keyMap' in out).toBe(false);
    // v9 이행으로 최상위 profile은 사라진다
    expect('profile' in out).toBe(false);
    const presets = out.presets as Record<string, unknown>[];
    expect(presets).toHaveLength(2);
    expect(presets[0]).toMatchObject({ id: 'a', name: 'A', createdAt: 'x', layout, soundSetId: 'synth' });
    expect(presets[1]).toMatchObject({ id: 'b', name: 'B', createdAt: 'y', layout, soundSetId: 'ssaplash' });
    expect('keyMap' in presets[0]).toBe(false);
    expect('profile' in presets[0]).toBe(false);
  });

  it('현재 설정에 soundSetId가 없으면 프리셋은 ssaplash로 채운다', () => {
    const out = run({ presets: [{ id: 'a', name: 'A', createdAt: 'x', layout }] });
    expect((out.presets as { soundSetId: string }[])[0].soundSetId).toBe('ssaplash');
  });

  it('layout 없는 프리셋은 이행 때 버려진다', () => {
    const out = run({
      presets: [{ id: 'bad', name: 'X', createdAt: 'x', keyMap: {}, profile: null }, null, { id: 'ok', name: 'O', createdAt: 'y', layout }],
    });
    expect((out.presets as { id: string }[]).map((x) => x.id)).toEqual(['ok']);
  });
});

describe('migrateSettings v8 → v9 (프로필 삭제·최초 설정·프리셋 적용 상태)', () => {
  const layout = KIT_LAYOUT_PRESETS.basic;
  const run = (p: Record<string, unknown>) => migrateSettings(p, 8) as unknown as Record<string, unknown>;

  it('profile·calibrationMode·holdMs를 지우고 firstSetupDone=false, activePresetId=null을 채운다', () => {
    const out = run({ profile: { anchors: {} }, calibrationMode: 'hits', holdMs: 3000, volume: 0.5, presets: [] });
    expect('profile' in out).toBe(false);
    expect('calibrationMode' in out).toBe(false);
    expect('holdMs' in out).toBe(false);
    expect(out.firstSetupDone).toBe(false);
    expect(out.activePresetId).toBeNull();
    expect(out.volume).toBe(0.5);
  });

  it('프리셋이 있으면 첫 항목을 적용 중·기본으로 하고 isDefault·schemaVersion·updatedAt을 채운다', () => {
    const out = run({
      presets: [
        { id: 'a', name: 'A', createdAt: 'x', layout, soundSetId: 'synth' },
        { id: 'b', name: 'B', createdAt: 'y', layout, soundSetId: 'ssaplash' },
      ],
    });
    expect(out.activePresetId).toBe('a');
    const presets = out.presets as Record<string, unknown>[];
    expect(presets[0]).toEqual({ id: 'a', name: 'A', createdAt: 'x', layout, soundSetId: 'synth', isDefault: true, schemaVersion: 1, updatedAt: 'x' });
    expect(presets[1]).toEqual({ id: 'b', name: 'B', createdAt: 'y', layout, soundSetId: 'ssaplash', isDefault: false, schemaVersion: 1, updatedAt: 'y' });
  });

  it('presets 필드가 없어도 빈 목록으로 이행한다', () => {
    const out = run({});
    expect(out.presets).toEqual([]);
    expect(out.activePresetId).toBeNull();
  });

  it('v10 상태는 그대로 통과한다', () => {
    const state = { firstSetupDone: true, activePresetId: 'z', presets: [] };
    expect(migrateSettings(state, 10)).toEqual(state);
  });
});

describe('migrateSettings v9 → v10 (패드 이름 이행)', () => {
  const basic = KIT_LAYOUT_PRESETS.basic;
  // v9 배치: HI_TOM 키 7개(MID_TOM·HIHAT_PEDAL 없음)
  const { SMALL_TOM: _s, MID_TOM: _m, HIHAT_PEDAL: _h, ...rest } = basic;
  void _s;
  void _m;
  void _h;
  const oldHiTom = { x: 0.11, y: 0.22, r: 0.33 };
  const v9Layout = { ...rest, HI_TOM: oldHiTom };
  const run = (p: Record<string, unknown>) => migrateSettings(p, 9) as unknown as Record<string, unknown>;

  const check = (layout: Record<string, unknown>) => {
    expect(layout.SMALL_TOM).toEqual(oldHiTom);
    expect(layout.MID_TOM).toEqual(basic.MID_TOM);
    expect(layout.HIHAT_PEDAL).toEqual(basic.HIHAT_PEDAL);
    expect('HI_TOM' in layout).toBe(false);
    expect(layout.SNARE).toEqual(basic.SNARE);
  };

  it('최상위 kitLayout과 프리셋 layout의 HI_TOM을 SMALL_TOM으로 옮기고 없는 패드를 채운다', () => {
    const out = run({
      kitLayout: v9Layout,
      presets: [{ id: 'a', name: 'A', soundSetId: 'synth', isDefault: true, schemaVersion: 1, createdAt: 'x', updatedAt: 'x', layout: v9Layout }],
    });
    check(out.kitLayout as Record<string, unknown>);
    const presets = out.presets as Record<string, unknown>[];
    check(presets[0].layout as Record<string, unknown>);
    expect(presets[0]).toMatchObject({ id: 'a', name: 'A', soundSetId: 'synth', isDefault: true, schemaVersion: 1, createdAt: 'x', updatedAt: 'x' });
  });

  it('kitLayout이 없거나 객체가 아니면 기본 배치, layout이 객체가 아닌 프리셋은 버린다', () => {
    const out = run({ kitLayout: 'broken', presets: [{ id: 'a', layout: null }, { id: 'b', layout: v9Layout }] });
    expect(out.kitLayout).toEqual(basic);
    expect((out.presets as { id: string }[]).map((x) => x.id)).toEqual(['b']);
    expect(run({}).kitLayout).toEqual(basic);
  });
});
