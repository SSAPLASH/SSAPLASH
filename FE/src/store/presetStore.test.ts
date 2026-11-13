import { beforeEach, describe, expect, it } from 'vitest';
import { usePresets, selectDirty } from './presetStore';
import { LocalPresetSource } from './localPresetSource';
import { useSettings } from './settingsStore';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { TIGHT_LAYOUT, WIDE_LAYOUT } from '@/test/layoutFixtures';
import { PresetError, SYSTEM_PRESET_ID, type PresetSource } from '@/domain/kit/preset';
import type { HandAnchors } from '@/domain/kit/calibration/calibration';
import { defaultHandAnchors } from '@/domain/kit/kitModel';

const ANCHOR = { pad: 'SNARE' as const, pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };
const ANCHORS: HandAnchors = [{ SNARE: ANCHOR }, null];

beforeEach(() => {
  useSettings.setState({
    presets: [],
    activePresetId: SYSTEM_PRESET_ID,
    presetAnchors: {},
    stickAnchors: [null, null],
    calibratedAt: null,
    kitLayout: DEFAULT_KIT_LAYOUT,
    soundSetId: 'ssaplash',
  });
  usePresets.setState({ source: new LocalPresetSource(), items: [], status: 'idle', error: null });
});

const dirty = () => selectDirty(useSettings.getState(), usePresets.getState());
const byName = (name: string) => usePresets.getState().items.find((p) => p.name === name)!;

describe('selectDirty 시스템 기본(kit-drag D8)', () => {
  it('끌지 않은 시스템 기본은 false', () => {
    expect(dirty()).toBe(false);
  });
  it('시스템 기본에서 패드를 끌면 true, 기본 배치로 되돌리면 false. 앵커는 null 그대로', () => {
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    expect(dirty()).toBe(true);
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    usePresets.getState().apply(SYSTEM_PRESET_ID);
    expect(dirty()).toBe(false);
  });
  it('끈 시스템 기본을 saveAs하면 옮긴 배치로 새 프리셋이 생기고 앵커 기록은 없다', async () => {
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    expect(await usePresets.getState().saveAs('새 배치')).toBe(true);
    const saved = usePresets.getState().items[0];
    expect(saved.layout.SNARE).toMatchObject({ x: 0.7, y: 0.3 });
    expect(useSettings.getState().activePresetId).toBe(saved.id);
    expect(useSettings.getState().presetAnchors[saved.id]).toBeUndefined();
    expect(dirty()).toBe(false);
  });
});

describe('presetStore', () => {
  it('saveAs: 만들고 적용하며 첫 프리셋은 기본', async () => {
    useSettings.setState({ soundSetId: 'synth' });
    expect(await usePresets.getState().saveAs(' 내 킷 ')).toBe(true);
    const { items, status } = usePresets.getState();
    expect(status).toBe('idle');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: '내 킷', isDefault: true });
    expect(useSettings.getState().activePresetId).toBe(items[0].id);
    expect(dirty()).toBe(false);
  });

  it('saveAs: 첫 프리셋이 기본이 아닌 소스(서버)면 setDefault를 부른다', async () => {
    const local = new LocalPresetSource();
    let called = '';
    const src: PresetSource = {
      list: () => local.list(),
      update: (i, d) => local.update(i, d),
      remove: (i) => local.remove(i),
      create: async (d) => {
        const p = await local.create(d);
        useSettings.getState().setPresets([{ ...p, isDefault: false }]);
        return { ...p, isDefault: false };
      },
      setDefault: (i) => {
        called = i;
        return local.setDefault(i);
      },
    };
    usePresets.getState().setSource(src);
    await usePresets.getState().saveAs('a');
    expect(called).toBe(usePresets.getState().items[0].id);
    expect(usePresets.getState().items[0].isDefault).toBe(true);
  });

  it('saveAs: 빈 이름은 상태를 건드리지 않고 false, 중복은 NAME_DUPLICATE', async () => {
    expect(await usePresets.getState().saveAs('  ')).toBe(false);
    expect(usePresets.getState().status).toBe('idle');
    await usePresets.getState().saveAs('a');
    expect(await usePresets.getState().saveAs('a')).toBe(false);
    expect(usePresets.getState()).toMatchObject({ status: 'error', error: 'NAME_DUPLICATE' });
    usePresets.getState().clearError();
    expect(usePresets.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('saveChanges: 적용 프리셋이 없거나 변경이 없으면 저장하지 않는다', async () => {
    expect(await usePresets.getState().saveChanges()).toBe(false);
    await usePresets.getState().saveAs('a');
    expect(await usePresets.getState().saveChanges()).toBe(false);
  });

  it('saveChanges: 변경이 있으면 update하고 dirty가 풀린다', async () => {
    await usePresets.getState().saveAs('a');
    useSettings.getState().setKitLayout(WIDE_LAYOUT);
    expect(dirty()).toBe(true);
    expect(await usePresets.getState().saveChanges()).toBe(true);
    expect(usePresets.getState().items[0].layout).toEqual(WIDE_LAYOUT);
    expect(dirty()).toBe(false);
  });

  it('saveChanges: 드래그로 옮긴 앵커를 저장 뒤 presetAnchors에 기록하고, apply로 다시 읽어도 유지된다(kit-drag D5)', async () => {
    const base = defaultHandAnchors();
    useSettings.getState().setStickAnchors(base, 5);
    await usePresets.getState().saveAs('a');
    const a = byName('a');
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    // 끄는 동안은 기록(presetAnchors)을 건드리지 않는다
    expect(useSettings.getState().presetAnchors[a.id]?.anchors).toEqual(base);
    expect(await usePresets.getState().saveChanges()).toBe(true);
    const moved = useSettings.getState().stickAnchors;
    expect(moved).not.toEqual(base);
    expect(useSettings.getState().presetAnchors[a.id]).toEqual({ anchors: moved, calibratedAt: 5 });
    usePresets.getState().apply(a.id);
    expect(useSettings.getState().stickAnchors).toEqual(moved);
    expect(useSettings.getState().kitLayout.SNARE).toMatchObject({ x: 0.7, y: 0.3 });
  });

  it('saveChanges: update가 실패하면 앵커 기록을 바꾸지 않는다', async () => {
    const base = defaultHandAnchors();
    useSettings.getState().setStickAnchors(base, 5);
    await usePresets.getState().saveAs('a');
    const a = byName('a');
    const src = usePresets.getState().source;
    usePresets.getState().setSource({ ...src, list: () => src.list(), update: () => Promise.reject(new PresetError('NETWORK')) } as PresetSource);
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    expect(await usePresets.getState().saveChanges()).toBe(false);
    expect(useSettings.getState().presetAnchors[a.id]?.anchors).toEqual(base);
  });

  it('movePad 후 저장 안 하고 apply하면 이동 전 배치·앵커로 복원된다', async () => {
    const base = defaultHandAnchors();
    useSettings.getState().setStickAnchors(base, 5);
    await usePresets.getState().saveAs('a');
    const a = byName('a');
    useSettings.getState().movePad('SNARE', 0.7, 0.3);
    expect(dirty()).toBe(true);
    usePresets.getState().apply(a.id);
    expect(useSettings.getState().stickAnchors).toEqual(base);
    expect(useSettings.getState().kitLayout).toEqual(a.layout);
    expect(dirty()).toBe(false);
  });

  it('apply: 배치·사운드를 덮어쓰고 activePresetId를 바꾼다', async () => {
    useSettings.getState().setKitLayout(TIGHT_LAYOUT);
    await usePresets.getState().saveAs('a');
    const id = usePresets.getState().items[0].id;
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID, soundSetId: 'synth' });
    useSettings.getState().resetLayout();
    usePresets.getState().apply(id);
    expect(useSettings.getState()).toMatchObject({ activePresetId: id, soundSetId: 'ssaplash' });
    expect(useSettings.getState().kitLayout).toEqual(TIGHT_LAYOUT);
  });

  it('apply: 앵커 사본을 그 프리셋 것으로 갈아끼운다. 기록이 없는 프리셋은 [null, null], 시스템 기본은 고정 배치·빈 사본(UX-64 D1·D2)', async () => {
    useSettings.getState().setKitLayout(TIGHT_LAYOUT);
    await usePresets.getState().saveAs('a');
    const a = byName('a');
    useSettings.getState().setStickAnchors(ANCHORS, 111); // 적용 중(a)에 기록된다
    expect(useSettings.getState().presetAnchors[a.id]).toEqual({ anchors: ANCHORS, calibratedAt: 111 });
    await usePresets.getState().saveAs('b'); // 현재 사본(앵커)이 b에도 기록되고 b가 적용된다
    const b = byName('b');
    expect(useSettings.getState().presetAnchors[b.id]?.calibratedAt).toBe(111);

    usePresets.getState().apply(SYSTEM_PRESET_ID);
    expect(useSettings.getState()).toMatchObject({ activePresetId: SYSTEM_PRESET_ID, stickAnchors: [null, null], calibratedAt: null });
    expect(useSettings.getState().kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
    expect(dirty()).toBe(false);

    usePresets.getState().apply(a.id);
    expect(useSettings.getState()).toMatchObject({ activePresetId: a.id, stickAnchors: ANCHORS, calibratedAt: 111 });
    expect(useSettings.getState().kitLayout).toEqual(TIGHT_LAYOUT);

    useSettings.getState().removePresetAnchors(a.id);
    usePresets.getState().apply(b.id);
    usePresets.getState().apply(a.id);
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
  });

  it('saveAs(draft): 초안의 배치로 만들고 초안 앵커를 새 프리셋에 기록한 뒤 적용한다(UX-64 D4)', async () => {
    useSettings.getState().setKitLayout(TIGHT_LAYOUT);
    expect(await usePresets.getState().saveAs('새', { anchors: ANCHORS, layout: WIDE_LAYOUT, calibratedAt: 222 })).toBe(true);
    const p = byName('새');
    expect(p.layout).toEqual(WIDE_LAYOUT);
    expect(useSettings.getState()).toMatchObject({ activePresetId: p.id, stickAnchors: ANCHORS, calibratedAt: 222 });
    expect(useSettings.getState().kitLayout).toEqual(WIDE_LAYOUT);
    expect(useSettings.getState().presetAnchors[p.id]).toEqual({ anchors: ANCHORS, calibratedAt: 222 });
  });

  it('remove: 적용 중 프리셋을 지우면 시스템 기본으로 돌아가고 앵커 기록도 지운다. 다른 걸 지우면 유지', async () => {
    await usePresets.getState().saveAs('a');
    useSettings.getState().setKitLayout(WIDE_LAYOUT);
    await usePresets.getState().saveAs('b');
    const a = byName('a');
    const b = byName('b');
    useSettings.getState().setStickAnchors(ANCHORS, 1);
    expect(useSettings.getState().activePresetId).toBe(b.id);
    await usePresets.getState().remove(a.id);
    expect(useSettings.getState().activePresetId).toBe(b.id);
    await usePresets.getState().remove(b.id);
    expect(useSettings.getState().activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(useSettings.getState().presetAnchors[b.id]).toBeUndefined();
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    expect(usePresets.getState().items).toHaveLength(0);
  });

  it('setDefault: 기본이 바뀐다', async () => {
    await usePresets.getState().saveAs('a');
    await usePresets.getState().saveAs('b');
    await usePresets.getState().setDefault(byName('b').id);
    expect(usePresets.getState().items[0].name).toBe('b');
  });

  it('소스 오류: 코드를 error로 두고 편집값은 그대로', async () => {
    const failing: PresetSource = {
      list: () => Promise.resolve([]),
      create: () => Promise.reject(new PresetError('LIMIT_EXCEEDED')),
      update: () => Promise.reject(new PresetError('CONFLICT')),
      remove: () => Promise.reject(new Error('boom')),
      setDefault: () => Promise.reject(new PresetError('NOT_FOUND')),
    };
    usePresets.getState().setSource(failing);
    useSettings.getState().setKitLayout(WIDE_LAYOUT);
    expect(await usePresets.getState().saveAs('a')).toBe(false);
    expect(usePresets.getState()).toMatchObject({ status: 'error', error: 'LIMIT_EXCEEDED' });
    expect(useSettings.getState().kitLayout).toEqual(WIDE_LAYOUT);
    expect(useSettings.getState().activePresetId).toBe(SYSTEM_PRESET_ID);
    await usePresets.getState().remove('x');
    expect(usePresets.getState().error).toBe('NETWORK');
  });

  it('refresh: 목록을 읽는다', async () => {
    await usePresets.getState().saveAs('a');
    usePresets.setState({ items: [] });
    await usePresets.getState().refresh();
    expect(usePresets.getState().items).toHaveLength(1);
  });
});
