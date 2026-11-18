// 로컬 프리셋 저장소. settingsStore.presets[](localStorage 영속)를 저장소로 쓰는 PresetSource 구현.
import {
  MAX_PRESETS,
  PRESET_SCHEMA_VERSION,
  PresetError,
  normalizePresetName,
  validatePresetName,
  type KitPreset,
  type PresetDraft,
  type PresetSource,
} from '@/domain/kit/preset';
import { useSettings } from './settingsStore';

function read(): KitPreset[] {
  return useSettings.getState().presets;
}

function write(list: KitPreset[]): void {
  useSettings.getState().setPresets(list);
}

/** 기본 프리셋 첫째, 나머지는 최근 생성 순(BE와 같은 정렬). 생성 시각이 같으면 저장 순서(새 항목이 앞)를 지킨다 */
function sorted(list: KitPreset[]): KitPreset[] {
  const byRecent = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return [...byRecent.filter((p) => p.isDefault), ...byRecent.filter((p) => !p.isDefault)];
}

function newId(list: KitPreset[]): string {
  const base = `local-${Date.now().toString(36)}`;
  let id = base;
  for (let n = 1; list.some((p) => p.id === id); n += 1) id = `${base}-${n}`;
  return id;
}

/** 이름 규칙 위반을 던진다. 빈 이름·길이 초과는 화면이 먼저 막으므로 일반 오류, 중복만 오류 코드가 있다 */
function assertName(raw: string, list: KitPreset[], exceptId?: string): string {
  const err = validatePresetName(raw, list, exceptId);
  if (err === 'DUPLICATE') throw new PresetError('NAME_DUPLICATE');
  if (err) throw new Error(`잘못된 프리셋 이름: ${err}`);
  return normalizePresetName(raw);
}

/** 동기 작업을 Promise로 감싼다. 던진 오류는 reject로 */
function settle<T>(job: () => T): Promise<T> {
  try {
    return Promise.resolve(job());
  } catch (e) {
    return Promise.reject(e);
  }
}

export class LocalPresetSource implements PresetSource {
  list(): Promise<KitPreset[]> {
    return settle(() => sorted(read()));
  }

  create(draft: PresetDraft): Promise<KitPreset> {
    return settle(() => {
      const list = read();
      const name = assertName(draft.name, list);
      if (list.length >= MAX_PRESETS) throw new PresetError('LIMIT_EXCEEDED');
      const now = new Date().toISOString();
      const preset: KitPreset = {
        id: newId(list),
        name,
        isDefault: list.length === 0,
        layout: draft.layout,
        soundSetId: draft.soundSetId,
        schemaVersion: PRESET_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      };
      write([preset, ...list]);
      return preset;
    });
  }

  update(id: string, draft: PresetDraft): Promise<KitPreset> {
    return settle(() => {
      const list = read();
      const old = list.find((p) => p.id === id);
      if (!old) throw new PresetError('NOT_FOUND');
      const name = assertName(draft.name, list, id);
      const next: KitPreset = {
        ...old,
        name,
        layout: draft.layout,
        soundSetId: draft.soundSetId,
        updatedAt: new Date().toISOString(),
      };
      write(list.map((p) => (p.id === id ? next : p)));
      return next;
    });
  }

  remove(id: string): Promise<void> {
    return settle(() => {
      const list = read();
      const target = list.find((p) => p.id === id);
      if (!target) throw new PresetError('NOT_FOUND');
      let rest = list.filter((p) => p.id !== id);
      // 기본을 지우면 남은 것 중 가장 최근 생성이 기본(BE 규칙)
      if (target.isDefault && rest.length > 0) {
        const heir = sorted(rest)[0].id;
        rest = rest.map((p) => (p.id === heir ? { ...p, isDefault: true } : p));
      }
      write(rest);
    });
  }

  setDefault(id: string): Promise<KitPreset> {
    return settle(() => {
      const list = read();
      if (!list.some((p) => p.id === id)) throw new PresetError('NOT_FOUND');
      const next = list.map((p) => (p.isDefault === (p.id === id) ? p : { ...p, isDefault: p.id === id }));
      write(next);
      return next.find((p) => p.id === id)!;
    });
  }
}
