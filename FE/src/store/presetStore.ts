// 프리셋 목록·저장 흐름 상태. 저장소는 PresetSource 뒤(기본 로컬). 영속하지 않는다(값의 주인은 소스).
import { create } from 'zustand';
import {
  PresetError,
  isDirty,
  validatePresetName,
  type KitPreset,
  type PresetErrorCode,
  type PresetSource,
} from '@/domain/preset';
import { LocalPresetSource } from './localPresetSource';
import { useSettings } from './settingsStore';

type Status = 'idle' | 'loading' | 'saving' | 'error';

interface PresetState {
  source: PresetSource;
  items: KitPreset[];
  status: Status;
  error: PresetErrorCode | null;

  setSource: (src: PresetSource) => void;
  refresh: () => Promise<void>;
  /** 프리셋 값을 현재 편집값(kitLayout·soundSetId)에 덮어쓰고 적용 상태로 둔다 */
  apply: (id: string) => void;
  /** 적용 중 프리셋이 있고 변경이 있을 때 update. 저장했으면 true */
  saveChanges: () => Promise<boolean>;
  /** 이름 검증 → create → apply. 이름이 비었거나 너무 길면 상태를 건드리지 않고 false. 성공 시 true */
  saveAs: (name: string) => Promise<boolean>;
  setDefault: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  clearError: () => void;
}

function toCode(e: unknown): PresetErrorCode {
  return e instanceof PresetError ? e.code : 'NETWORK';
}

export const usePresets = create<PresetState>()((set, get) => {
  /** 쓰기 작업 공통: 저장 중 중복 호출 방지, 성공 시 idle, 실패 시 error(편집값은 그대로) */
  async function run(job: () => Promise<void>): Promise<boolean> {
    if (get().status === 'saving') return false;
    set({ status: 'saving', error: null });
    try {
      await job();
      set({ status: 'idle' });
      return true;
    } catch (e) {
      set({ status: 'error', error: toCode(e) });
      return false;
    }
  }

  async function reload(): Promise<void> {
    set({ items: await get().source.list() });
  }

  return {
    source: new LocalPresetSource(),
    items: [],
    status: 'idle',
    error: null,

    setSource: (source) => set({ source, items: [], status: 'idle', error: null }),

    refresh: async () => {
      set({ status: 'loading', error: null });
      try {
        set({ items: await get().source.list(), status: 'idle' });
      } catch (e) {
        set({ status: 'error', error: toCode(e) });
      }
    },

    apply: (id) => {
      const p = get().items.find((x) => x.id === id);
      if (!p) return;
      useSettings.setState({ kitLayout: p.layout, soundSetId: p.soundSetId, activePresetId: id });
    },

    saveChanges: () => {
      const s = useSettings.getState();
      const active = get().items.find((x) => x.id === s.activePresetId);
      if (!active || !isDirty({ layout: s.kitLayout, soundSetId: s.soundSetId }, active)) return Promise.resolve(false);
      return run(async () => {
        await get().source.update(active.id, { name: active.name, layout: s.kitLayout, soundSetId: s.soundSetId });
        await reload();
      });
    },

    saveAs: (name) => {
      const verdict = validatePresetName(name, get().items);
      if (verdict === 'EMPTY' || verdict === 'TOO_LONG') return Promise.resolve(false);
      if (verdict === 'DUPLICATE') {
        set({ status: 'error', error: 'NAME_DUPLICATE' });
        return Promise.resolve(false);
      }
      const s = useSettings.getState();
      return run(async () => {
        const isFirst = get().items.length === 0;
        const created = await get().source.create({ name, layout: s.kitLayout, soundSetId: s.soundSetId });
        // 서버 소스는 첫 프리셋도 기본이 아닐 수 있다(BE: PUT .../default 필요)
        if (isFirst && !created.isDefault) await get().source.setDefault(created.id);
        await reload();
        get().apply(created.id);
      });
    },

    setDefault: (id) =>
      run(async () => {
        await get().source.setDefault(id);
        await reload();
      }),

    remove: (id) =>
      run(async () => {
        await get().source.remove(id);
        await reload();
        if (useSettings.getState().activePresetId === id) useSettings.getState().setActivePresetId(null);
      }),

    clearError: () => set({ status: 'idle', error: null }),
  };
});

/** 변경 여부(적용 프리셋과 현재 편집값 비교). 적용 프리셋이 없으면 true */
export function selectDirty(
  settings: { kitLayout: KitPreset['layout']; soundSetId: KitPreset['soundSetId']; activePresetId: string | null },
  presets: { items: KitPreset[] },
): boolean {
  const active = presets.items.find((p) => p.id === settings.activePresetId);
  return isDirty({ layout: settings.kitLayout, soundSetId: settings.soundSetId }, active);
}
