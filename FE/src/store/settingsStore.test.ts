import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, migrateSettings, sanitizePresetAnchors, sanitizeTimingSettings, useSettings } from './settingsStore';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { SYSTEM_PRESET_ID } from '@/domain/kit/preset';
import { WIDE_LAYOUT } from '@/test/layoutFixtures';
import { DEFAULT_SENSOR_TUNING, mergeTuning } from '@/domain/kit/calibration/tuning';
import { anchorsToLayout, defaultHandAnchors } from '@/domain/kit/kitModel';

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
    expect(out.tuning.maxRadiusDeg).toBe(45);
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
  it('setKitLayout은 kitLayout을 바꾸고 resetLayout은 기본으로 되돌린다', () => {
    useSettings.getState().setKitLayout(WIDE_LAYOUT);
    expect(useSettings.getState().kitLayout).toEqual(WIDE_LAYOUT);
    useSettings.getState().resetLayout();
    expect(useSettings.getState().kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
  });
});

describe('migrateSettings v7 → v8 (키 매핑 폐기·프리셋 정리)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 7) as unknown as Record<string, unknown>;
  const layout = DEFAULT_KIT_LAYOUT;

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
  const layout = DEFAULT_KIT_LAYOUT;
  const run = (p: Record<string, unknown>) => migrateSettings(p, 8) as unknown as Record<string, unknown>;

  it('profile·calibrationMode·holdMs를 지우고 firstSetupDone=false, activePresetId는 (v18까지 이행돼) system', () => {
    const out = run({ profile: { anchors: {} }, calibrationMode: 'hits', holdMs: 3000, volume: 0.5, presets: [] });
    expect('profile' in out).toBe(false);
    expect('calibrationMode' in out).toBe(false);
    expect('holdMs' in out).toBe(false);
    expect(out.firstSetupDone).toBe(false);
    expect(out.activePresetId).toBe(SYSTEM_PRESET_ID);
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
    expect(out.activePresetId).toBe(SYSTEM_PRESET_ID);
  });

  it('v10 상태는 그대로 통과한다', () => {
    const state = { firstSetupDone: true, activePresetId: 'z', presets: [] };
    expect(migrateSettings(state, 10)).toEqual(state);
  });
});

describe('migrateSettings v9 → v10 (패드 이름 이행)', () => {
  const basic = DEFAULT_KIT_LAYOUT;
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

describe('migrateSettings v10 → v11 (sheetPadCount)', () => {
  it('v10 이하 저장분에 sheetPadCount=true를 채운다', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect((migrateSettings({}, 10) as unknown as Record<string, unknown>).sheetPadCount).toBe(true);
  });

  it('v11 상태의 sheetPadCount는 건드리지 않는다', () => {
    const out = migrateSettings({ sheetPadCount: false }, 11) as unknown as Record<string, unknown>;
    expect(out.sheetPadCount).toBe(false);
  });
});

describe('migrateSettings v11 → v12 (셸 설정)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 11) as unknown as Record<string, unknown>;

  it('새 키 3개를 기본값으로 채운다', () => {
    const out = run({});
    expect(out.sidebarCollapsed).toBe(false);
    expect(out.dockCollapsed).toBe(false);
    expect(out.liveCoach).toBe(true);
  });

  it('이미 있는 boolean 값은 보존한다', () => {
    const out = run({ sidebarCollapsed: true, dockCollapsed: true, liveCoach: false });
    expect(out.sidebarCollapsed).toBe(true);
    expect(out.dockCollapsed).toBe(true);
    expect(out.liveCoach).toBe(false);
  });

  it('boolean이 아닌 저장값은 기본값으로 되돌린다', () => {
    const out = run({ liveCoach: 'no' });
    expect(out.liveCoach).toBe(true);
  });

  it('다른 기존 키는 유지한다', () => {
    const out = run({ sheetPadCount: false, volume: 0.3 });
    expect(out.sheetPadCount).toBe(false);
    expect(out.volume).toBe(0.3);
  });
});

describe('migrateSettings v13 → v14 (statsConsent 삭제)', () => {
  it('저장돼 있던 statsConsent를 버린다', () => {
    const out = migrateSettings({ statsConsent: true, liveCoach: false }, 13) as unknown as Record<string, unknown>;
    expect('statsConsent' in out).toBe(false);
    expect(out.liveCoach).toBe(false);
  });
});

describe('migrateSettings v16 → v17 (손별 앵커, PLAY-004)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 16) as unknown as Record<string, unknown>;

  it('stickAnchors가 없으면 [null, null], calibratedAt은 null', () => {
    const out = run({ kitSkin: 'acoustic' });
    expect(out.stickAnchors).toEqual([null, null]);
    expect(out.calibratedAt).toBeNull();
  });

  it('깨진 앵커(숫자 아님)는 버리고 멀쩡한 손만 남긴다(사용자 프리셋 적용 중이라 v18에서도 사본이 남는다)', () => {
    const good = { pad: 'SNARE', pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };
    const out = run({ activePresetId: 'p', stickAnchors: [{ SNARE: good, HIHAT: { pitch: 'x', yaw: 0 } }, 'bad'], calibratedAt: 123 });
    expect(out.stickAnchors).toEqual([{ SNARE: good }, null]);
    expect(out.calibratedAt).toBe(123);
  });

  it('setStickAnchors는 앵커와 시각을 저장하고 clearStickAnchors는 비운다. 배치·프리셋 id를 바꿔도 사본은 그대로', () => {
    const good = { pad: 'SNARE' as const, pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID, presetAnchors: {} });
    useSettings.getState().setStickAnchors([{ SNARE: good }, null], 999);
    expect(useSettings.getState().stickAnchors).toEqual([{ SNARE: good }, null]);
    expect(useSettings.getState().calibratedAt).toBe(999);
    useSettings.getState().setKitLayout(WIDE_LAYOUT);
    useSettings.getState().setActivePresetId('p');
    expect(useSettings.getState().stickAnchors[0]?.SNARE).toEqual(good);
    useSettings.getState().clearStickAnchors();
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    expect(useSettings.getState().calibratedAt).toBeNull();
  });

  it('merge는 저장분의 tuning에 minRadiusDeg가 없으면 기본값 15로 채운다', () => {
    const t = mergeTuning(DEFAULT_SENSOR_TUNING, { radiusFactor: 0.5 });
    expect(t.minRadiusDeg).toBe(15);
    expect(DEFAULT_SENSOR_TUNING).toMatchObject({ radiusFactor: 0.6, minRadiusDeg: 15, maxRadiusDeg: 35 });
  });
});

describe('migrateSettings v17 → v18 (프리셋별 앵커·시스템 기본, UX-64)', () => {
  const run = (p: Record<string, unknown>) => migrateSettings(p, 17) as unknown as Record<string, unknown>;
  const good = { pad: 'SNARE', pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };

  it('activePresetId null → system, 사본·시각을 비우고 presetAnchors는 {}', () => {
    const out = run({ activePresetId: null, stickAnchors: [{ SNARE: good }, null], calibratedAt: 5 });
    expect(out.activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(out.stickAnchors).toEqual([null, null]);
    expect(out.calibratedAt).toBeNull();
    expect(out.presetAnchors).toEqual({});
  });

  it('사용자 프리셋이 적용 중이고 앵커가 있으면 그 id로 기록을 옮기고 사본은 유지', () => {
    const out = run({ activePresetId: 'local-1', stickAnchors: [{ SNARE: good }, null], calibratedAt: 5 });
    expect(out.activePresetId).toBe('local-1');
    expect(out.stickAnchors).toEqual([{ SNARE: good }, null]);
    expect(out.presetAnchors).toEqual({ 'local-1': { anchors: [{ SNARE: good }, null], calibratedAt: 5 } });
  });

  it('앵커가 없으면 기록을 만들지 않는다', () => {
    const out = run({ activePresetId: 'local-1', stickAnchors: [null, null], calibratedAt: null });
    expect(out.presetAnchors).toEqual({});
  });

  it('v1부터 올려도 system이 된다', () => {
    const out = migrateSettings({ inputKind: 'pointer' }, 1) as unknown as Record<string, unknown>;
    expect(out.activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(out.presetAnchors).toEqual({});
  });

  it('sanitizePresetAnchors: 형이 아니면 {}, 앵커가 비었거나 시각이 숫자가 아닌 항목은 버린다. radiusOverride는 남긴다', () => {
    expect(sanitizePresetAnchors(null)).toEqual({});
    expect(sanitizePresetAnchors([1])).toEqual({});
    const out = sanitizePresetAnchors({
      a: { anchors: [{ SNARE: { ...good, radiusOverride: 22 } }, null], calibratedAt: 7 },
      b: { anchors: [null, null], calibratedAt: 7 },
      c: { anchors: [{ SNARE: good }, null], calibratedAt: 'x' },
      d: 3,
    });
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a.anchors[0]?.SNARE?.radiusOverride).toBe(22);
  });

  it('setStickAnchors는 적용 중 사용자 프리셋에 기록하고, 시스템 기본이면 기록하지 않는다', () => {
    const g = { ...good, pad: 'SNARE' as const };
    useSettings.setState({ activePresetId: 'p1', presetAnchors: {} });
    useSettings.getState().setStickAnchors([{ SNARE: g }, null], 10);
    expect(useSettings.getState().presetAnchors.p1).toEqual({ anchors: [{ SNARE: g }, null], calibratedAt: 10 });
    useSettings.getState().clearStickAnchors();
    expect(useSettings.getState().presetAnchors.p1).toBeUndefined();

    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID, presetAnchors: {} });
    useSettings.getState().setStickAnchors([{ SNARE: g }, null], 11);
    expect(useSettings.getState().presetAnchors).toEqual({});
  });

  it('setPresetAnchors는 기록을 넣고 적용 중 프리셋이면 사본도 바꾼다. removePresetAnchors는 기록만 지운다', () => {
    const g = { ...good, pad: 'SNARE' as const };
    useSettings.setState({ activePresetId: 'p2', presetAnchors: {}, stickAnchors: [null, null], calibratedAt: null });
    useSettings.getState().setPresetAnchors('p1', { anchors: [{ SNARE: g }, null], calibratedAt: 1 });
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    useSettings.getState().setPresetAnchors('p2', { anchors: [null, { SNARE: g }], calibratedAt: 2 });
    expect(useSettings.getState()).toMatchObject({ stickAnchors: [null, { SNARE: g }], calibratedAt: 2 });
    useSettings.getState().removePresetAnchors('p1');
    expect(Object.keys(useSettings.getState().presetAnchors)).toEqual(['p2']);
  });

  it('setRadiusOverride는 양손 그 패드 앵커의 radius·radiusOverride를 하한~상한으로 자른 값으로 두고 기록에도 반영한다', () => {
    const g = { ...good, pad: 'SNARE' as const };
    useSettings.setState({ activePresetId: 'p1', presetAnchors: {}, tuning: DEFAULT_SENSOR_TUNING });
    useSettings.getState().setStickAnchors([{ SNARE: g }, { SNARE: { ...g, yaw: 8 } }], 3);
    useSettings.getState().setRadiusOverride('SNARE', 60);
    const s = useSettings.getState();
    expect(s.stickAnchors[0]?.SNARE).toMatchObject({ radius: 35, radiusOverride: 35 });
    expect(s.stickAnchors[1]?.SNARE).toMatchObject({ radius: 35, radiusOverride: 35, yaw: 8 });
    expect(s.presetAnchors.p1.anchors[1]?.SNARE?.radiusOverride).toBe(35);
    useSettings.getState().setRadiusOverride('HIHAT', 20); // 앵커가 없는 패드는 무시
    expect(useSettings.getState().stickAnchors[0]?.HIHAT).toBeUndefined();
    useSettings.getState().setRadiusOverride('SNARE', 1);
    expect(useSettings.getState().stickAnchors[0]?.SNARE?.radius).toBe(15);
  });

  it('스토어 초기값은 system·빈 기록', () => {
    expect(SETTINGS_VERSION).toBe(27);
    expect(useSettings.getInitialState().activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(useSettings.getInitialState().presetAnchors).toEqual({});
  });
});

describe('movePad (드래그 편집, kit-drag)', () => {
  it('시스템 프리셋도 배치만 옮기고 앵커는 null 그대로 둔다(D9)', () => {
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID, kitLayout: DEFAULT_KIT_LAYOUT, stickAnchors: [null, null], presetAnchors: {} });
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    const s = useSettings.getState();
    expect(s.kitLayout.SNARE).toMatchObject({ x: 0.7, y: 0.3 });
    expect(s.kitLayout.RIDE).toEqual(DEFAULT_KIT_LAYOUT.RIDE);
    expect(s.stickAnchors).toEqual([null, null]);
    expect(s.presetAnchors).toEqual({});
  });

  it('사용자 프리셋이면 배치와 앵커를 옮기고 presetAnchors·calibratedAt은 그대로 둔다. 범위는 0.05~0.95로 자른다', () => {
    const base = defaultHandAnchors();
    const records = { p1: { anchors: base, calibratedAt: 9 } };
    useSettings.setState({ activePresetId: 'p1', kitLayout: anchorsToLayout(base, DEFAULT_KIT_LAYOUT), stickAnchors: base, calibratedAt: 9, presetAnchors: records, tuning: DEFAULT_SENSOR_TUNING });
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    let s = useSettings.getState();
    expect(s.kitLayout.SNARE).toMatchObject({ x: 0.7, y: 0.3 });
    expect(anchorsToLayout(s.stickAnchors, DEFAULT_KIT_LAYOUT).SNARE.x).toBeCloseTo(0.7, 3);
    expect(anchorsToLayout(s.stickAnchors, DEFAULT_KIT_LAYOUT).SNARE.y).toBeCloseTo(0.3, 3);
    expect(s.presetAnchors).toBe(records);
    expect(s.calibratedAt).toBe(9);
    useSettings.getState().movePad('SNARE', 2, -1);
    s = useSettings.getState();
    expect(s.kitLayout.SNARE).toMatchObject({ x: 0.95, y: 0.05 });
  });

  it('앵커가 없으면 배치만 옮긴다', () => {
    useSettings.setState({ activePresetId: 'p1', kitLayout: DEFAULT_KIT_LAYOUT, stickAnchors: [null, null], presetAnchors: {} });
    useSettings.getState().movePad('KICK', 0.4, 0.8);
    expect(useSettings.getState().kitLayout.KICK).toMatchObject({ x: 0.4, y: 0.8 });
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
  });
});

describe('migrateSettings v22 → v23 (시스템 기본 배치 변경)', () => {
  const legacy = {
    CRASH: { x: 0.2, y: 0.22, r: 0.1 },
    HIHAT: { x: 0.24, y: 0.52, r: 0.085 },
    SNARE: { x: 0.42, y: 0.68, r: 0.095 },
    SMALL_TOM: { x: 0.42, y: 0.34, r: 0.07 },
    MID_TOM: { x: 0.6, y: 0.34, r: 0.07 },
    FLOOR_TOM: { x: 0.72, y: 0.66, r: 0.1 },
    RIDE: { x: 0.8, y: 0.26, r: 0.11 },
    KICK: { x: 0.58, y: 0.9, r: 0.065 },
    HIHAT_PEDAL: { x: 0.24, y: 0.9, r: 0.055 },
  };

  it('옛 기본 배치 그대로인 저장 값은 새 기본 배치로 바꾼다', () => {
    const out = migrateSettings({ kitLayout: legacy }, 22);
    expect(out.kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
  });

  it('손으로 옮긴 배치는 그대로 둔다', () => {
    const moved = { ...legacy, SNARE: { x: 0.5, y: 0.7, r: 0.095 } };
    expect(migrateSettings({ kitLayout: moved }, 22).kitLayout).toEqual(moved);
  });

  it('v23 저장 값은 건드리지 않는다', () => {
    expect(migrateSettings({ kitLayout: legacy }, 23).kitLayout).toEqual(legacy);
  });
});

describe('판정 타이밍 보정·박자 맞추기 기록', () => {
  const merge = sanitizeTimingSettings;

  it('기본값은 0, 기록 없음', () => {
    expect(useSettings.getInitialState()).toMatchObject({ audioOffsetMs: 0, timingCal: null });
  });

  it('setAudioOffsetMs는 5ms 단위로 맞추고 −250~+100으로 자른다', () => {
    const st = useSettings.getState();
    st.setAudioOffsetMs(-67);
    expect(useSettings.getState().audioOffsetMs).toBe(-65);
    st.setAudioOffsetMs(180);
    expect(useSettings.getState().audioOffsetMs).toBe(100);
    st.setAudioOffsetMs(-999);
    expect(useSettings.getState().audioOffsetMs).toBe(-250);
    st.setAudioOffsetMs(0);
  });

  it('옛 범위로 저장된 값(+150)은 읽을 때 지금 범위로 자른다', () => {
    expect(merge({ audioOffsetMs: 150 }).audioOffsetMs).toBe(100);
    expect(merge({ audioOffsetMs: -40 }).audioOffsetMs).toBe(-40);
    expect(merge({ audioOffsetMs: 'x' }).audioOffsetMs).toBe(0);
  });

  it('박자 맞추기 기록은 저장분에서 복원하고, 모양이 틀리면 버린다', () => {
    const rec = { measuredAt: 1, medianMs: -66.5, madMs: 9, pairs: 12, input: 'sensor', outputLatencyMs: 45 };
    // 옛 저장분(kick 없음)도 그대로 읽는다
    expect(merge({ timingCal: rec }).timingCal).toEqual({ ...rec, kick: null });
    const kick = { medianMs: -40, madMs: 6, pairs: 11 };
    expect(merge({ timingCal: { ...rec, kick } }).timingCal).toEqual({ ...rec, kick });
    expect(merge({}).timingCal).toBeNull();
    expect(merge({ timingCal: { ...rec, input: 'mouse' } }).timingCal).toBeNull();
    expect(merge({ timingCal: { ...rec, outputLatencyMs: 'x' } }).timingCal).toMatchObject({ outputLatencyMs: null });
  });

  it('setTimingCal로 기록을 넣고 지운다', () => {
    const rec = { measuredAt: 2, medianMs: -10, madMs: 3, pairs: 11, input: 'keyboard' as const, outputLatencyMs: null, kick: null };
    useSettings.getState().setTimingCal(rec);
    expect(useSettings.getState().timingCal).toEqual(rec);
    useSettings.getState().setTimingCal(null);
    expect(useSettings.getState().timingCal).toBeNull();
  });
});

describe('박자 맞추기 권유 상태(timingCalPrompt)', () => {
  const merge = sanitizeTimingSettings;
  const rec = { measuredAt: 1, medianMs: -66.5, madMs: 9, pairs: 12, input: 'sensor', outputLatencyMs: 45 };

  it('기본값은 none', () => {
    expect(useSettings.getInitialState().timingCalPrompt).toBe('none');
  });

  it('값이 없던 저장분: 기록이 있으면 done, 없으면 none', () => {
    expect(merge({ timingCal: rec }).timingCalPrompt).toBe('done');
    expect(merge({}).timingCalPrompt).toBe('none');
  });

  it('저장된 세 값은 그대로 유지한다(skipped도 기록이 없으면 유지)', () => {
    expect(merge({ timingCalPrompt: 'skipped' }).timingCalPrompt).toBe('skipped');
    expect(merge({ timingCalPrompt: 'done' }).timingCalPrompt).toBe('done');
    expect(merge({ timingCalPrompt: 'none', timingCal: rec }).timingCalPrompt).toBe('none');
  });

  it('이상한 값은 없는 값처럼 다룬다', () => {
    expect(merge({ timingCalPrompt: 'later' }).timingCalPrompt).toBe('none');
    expect(merge({ timingCalPrompt: 3, timingCal: rec }).timingCalPrompt).toBe('done');
    expect(merge({ timingCalPrompt: null }).timingCalPrompt).toBe('none');
  });

  it('setTimingCalPrompt로 바꾼다', () => {
    useSettings.getState().setTimingCalPrompt('skipped');
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
    useSettings.getState().setTimingCalPrompt('none');
  });
});
