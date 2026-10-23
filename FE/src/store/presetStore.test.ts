import { beforeEach, describe, expect, it } from 'vitest';
import { usePresets, selectDirty } from './presetStore';
import { LocalPresetSource } from './localPresetSource';
import { useSettings } from './settingsStore';
import { DEFAULT_KIT_LAYOUT, KIT_LAYOUT_PRESETS } from '@/domain/kitLayout';
import { PresetError, type PresetSource } from '@/domain/preset';

beforeEach(() => {
  useSettings.setState({
    presets: [],
    activePresetId: null,
    kitLayout: DEFAULT_KIT_LAYOUT,
    soundSetId: 'ssaplash',
  });
  usePresets.setState({ source: new LocalPresetSource(), items: [], status: 'idle', error: null });
});

const dirty = () => selectDirty(useSettings.getState(), usePresets.getState());
const byName = (name: string) => usePresets.getState().items.find((p) => p.name === name)!;

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
    useSettings.getState().applyLayoutPreset('wide');
    expect(dirty()).toBe(true);
    expect(await usePresets.getState().saveChanges()).toBe(true);
    expect(usePresets.getState().items[0].layout).toEqual(KIT_LAYOUT_PRESETS.wide);
    expect(dirty()).toBe(false);
  });

  it('apply: 배치·사운드를 덮어쓰고 activePresetId를 바꾼다', async () => {
    useSettings.getState().applyLayoutPreset('tight');
    await usePresets.getState().saveAs('a');
    const id = usePresets.getState().items[0].id;
    useSettings.setState({ activePresetId: null, soundSetId: 'synth' });
    useSettings.getState().resetLayout();
    usePresets.getState().apply(id);
    expect(useSettings.getState()).toMatchObject({ activePresetId: id, soundSetId: 'ssaplash' });
    expect(useSettings.getState().kitLayout).toEqual(KIT_LAYOUT_PRESETS.tight);
  });

  it('remove: 적용 중 프리셋을 지우면 activePresetId가 null, 다른 걸 지우면 유지', async () => {
    await usePresets.getState().saveAs('a');
    useSettings.getState().applyLayoutPreset('wide');
    await usePresets.getState().saveAs('b');
    const a = byName('a');
    const b = byName('b');
    expect(useSettings.getState().activePresetId).toBe(b.id);
    await usePresets.getState().remove(a.id);
    expect(useSettings.getState().activePresetId).toBe(b.id);
    await usePresets.getState().remove(b.id);
    expect(useSettings.getState().activePresetId).toBeNull();
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
    useSettings.getState().applyLayoutPreset('wide');
    expect(await usePresets.getState().saveAs('a')).toBe(false);
    expect(usePresets.getState()).toMatchObject({ status: 'error', error: 'LIMIT_EXCEEDED' });
    expect(useSettings.getState().kitLayout).toEqual(KIT_LAYOUT_PRESETS.wide);
    expect(useSettings.getState().activePresetId).toBeNull();
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
