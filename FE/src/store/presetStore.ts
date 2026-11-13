// 프리셋 목록·저장 흐름 상태. 저장소는 PresetSource 뒤(기본 로컬). 영속하지 않는다(값의 주인은 소스).
import { create } from 'zustand';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import {
  PresetError,
  SYSTEM_PRESET_ID,
  isDirty,
  isSystemPreset,
  layoutEquals,
  validatePresetName,
  type CaptureDraft,
  type KitPreset,
  type PresetErrorCode,
  type PresetSource,
} from '@/domain/kit/preset';
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
  /**
   * 프리셋 값을 현재 편집값(kitLayout·soundSetId)에 덮어쓰고 적용 상태로 둔다. 앵커 사본도 그 프리셋 것으로 갈아끼운다(UX-64 D2).
   * SYSTEM_PRESET_ID면 고정 배치·모델 기본 앵커. 목록에 없는 id는 무동작
   */
  apply: (id: string) => void;
  /** 적용 중 프리셋이 있고 변경이 있을 때 update. 저장했으면 true */
  saveChanges: () => Promise<boolean>;
  /**
   * 이름 검증 → create → apply. 이름이 비었거나 너무 길면 상태를 건드리지 않고 false. 성공 시 true.
   * draft(추가하기 보정 결과)를 주면 현재 편집값 대신 초안의 배치를 저장하고 앵커를 그 프리셋에 기록한다(UX-64 D4)
   */
  saveAs: (name: string, draft?: CaptureDraft) => Promise<boolean>;
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
      if (isSystemPreset(id)) {
        useSettings.setState({ kitLayout: DEFAULT_KIT_LAYOUT, activePresetId: SYSTEM_PRESET_ID, stickAnchors: [null, null], calibratedAt: null });
        return;
      }
      const p = get().items.find((x) => x.id === id);
      if (!p) return;
      const rec = useSettings.getState().presetAnchors[id];
      useSettings.setState({
        kitLayout: p.layout,
        soundSetId: p.soundSetId,
        activePresetId: id,
        stickAnchors: rec ? [rec.anchors[0], rec.anchors[1]] : [null, null],
        calibratedAt: rec?.calibratedAt ?? null,
      });
    },

    saveChanges: () => {
      const s = useSettings.getState();
      const active = get().items.find((x) => x.id === s.activePresetId);
      if (!active || !isDirty({ layout: s.kitLayout, soundSetId: s.soundSetId }, active)) return Promise.resolve(false);
      return run(async () => {
        await get().source.update(active.id, { name: active.name, layout: s.kitLayout, soundSetId: s.soundSetId });
        // 드래그로 옮긴 앵커를 기기 로컬 기록에도 남긴다(kit-drag 설계 D5). update가 실패하면 여기까지 오지 않는다
        const cur = useSettings.getState();
        if ((cur.stickAnchors[0] || cur.stickAnchors[1]) && cur.calibratedAt !== null) {
          cur.setPresetAnchors(active.id, { anchors: cur.stickAnchors, calibratedAt: cur.calibratedAt });
        }
        await reload();
      });
    },

    saveAs: (name, draft) => {
      const verdict = validatePresetName(name, get().items);
      if (verdict === 'EMPTY' || verdict === 'TOO_LONG') return Promise.resolve(false);
      if (verdict === 'DUPLICATE') {
        set({ status: 'error', error: 'NAME_DUPLICATE' });
        return Promise.resolve(false);
      }
      const s = useSettings.getState();
      return run(async () => {
        const isFirst = get().items.length === 0;
        const created = await get().source.create({ name, layout: draft?.layout ?? s.kitLayout, soundSetId: s.soundSetId });
        // 서버 소스는 첫 프리셋도 기본이 아닐 수 있다(BE: PUT .../default 필요)
        if (isFirst && !created.isDefault) await get().source.setDefault(created.id);
        // 초안 앵커는 기기 로컬에 그 프리셋 id로 기록한다. 현재 편집값으로 저장할 때는 사본 앵커가 새 프리셋 것이 된다
        const anchors = draft ? draft.anchors : s.stickAnchors;
        const at = draft ? draft.calibratedAt : s.calibratedAt;
        if ((anchors[0] || anchors[1]) && at !== null) useSettings.getState().setPresetAnchors(created.id, { anchors, calibratedAt: at });
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
        useSettings.getState().removePresetAnchors(id);
        // 적용 중이던 것을 지우면 시스템 기본으로 돌아간다(UX-64 D1)
        if (useSettings.getState().activePresetId === id) get().apply(SYSTEM_PRESET_ID);
      }),

    clearError: () => set({ status: 'idle', error: null }),
  };
});

/**
 * 변경 여부(적용 프리셋과 현재 편집값 비교). 시스템 기본은 고정이라 저장할 수 없지만, 배치를 끌어 옮겼으면
 * (기본 배치와 다르면) true — 새 프리셋으로 저장할 것이 있다(kit-drag D8). 소리 세트는 비교하지 않는다,
 * 사용자 프리셋인데 목록에 없으면(저장소 전환 직후) 저장할 것이 있는 것으로 보아 true
 */
export function selectDirty(
  settings: { kitLayout: KitPreset['layout']; soundSetId: KitPreset['soundSetId']; activePresetId: string },
  presets: { items: KitPreset[] },
): boolean {
  if (isSystemPreset(settings.activePresetId)) return !layoutEquals(settings.kitLayout, DEFAULT_KIT_LAYOUT);
  const active = presets.items.find((p) => p.id === settings.activePresetId);
  return isDirty({ layout: settings.kitLayout, soundSetId: settings.soundSetId }, active);
}
