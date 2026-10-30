// 키트 프리셋 도메인: 타입·상수·이름 검증·변경 여부 판정. 저장소(로컬/서버)는 PresetSource 뒤에 둔다.
import type { KitLayout } from './kitLayout';
import { ALL_PADS } from './pads';
// 타입만 가져온다(런타임 의존 없음). 사운드 세트 id의 주인은 audio/soundSets
import type { SoundSetId } from './soundSet';

/** 프리셋 상한(BE와 동일) */
export const MAX_PRESETS = 10;
/** 프리셋 스키마 버전(서버 저장 형식과 맞춘다) */
export const PRESET_SCHEMA_VERSION = 1;
/** 이름 최대 길이(trim 뒤). BE는 50자까지 받지만 표시 공간 때문에 FE에서 20자로 제한한다 */
export const PRESET_NAME_MAX = 20;

export interface KitPreset {
  id: string;
  name: string;
  /** 기본 프리셋 여부(앱 시작 시 자동 적용 대상) */
  isDefault: boolean;
  layout: KitLayout;
  soundSetId: SoundSetId;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** 생성·수정 본문 */
export interface PresetDraft {
  name: string;
  layout: KitLayout;
  soundSetId: SoundSetId;
}

export type PresetErrorCode = 'NAME_DUPLICATE' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'CONFLICT' | 'NETWORK';

export class PresetError extends Error {
  readonly code: PresetErrorCode;

  constructor(code: PresetErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PresetError';
    this.code = code;
  }
}

/** 프리셋 저장소. 로컬 구현은 store/localPresetSource, 서버 구현은 api 쪽에서 같은 형태로 끼운다 */
export interface PresetSource {
  list(): Promise<KitPreset[]>;
  create(draft: PresetDraft): Promise<KitPreset>;
  update(id: string, draft: PresetDraft): Promise<KitPreset>;
  remove(id: string): Promise<void>;
  setDefault(id: string): Promise<KitPreset>;
}

export type PresetNameError = 'EMPTY' | 'TOO_LONG' | 'DUPLICATE';

export function normalizePresetName(raw: string): string {
  return raw.trim();
}

/** 이름 검증. 대소문자를 구분하며(BE와 동일) `exceptId`는 수정 중인 자기 자신을 중복에서 뺀다 */
export function validatePresetName(raw: string, existing: KitPreset[], exceptId?: string): PresetNameError | null {
  const name = normalizePresetName(raw);
  if (name.length === 0) return 'EMPTY';
  if (name.length > PRESET_NAME_MAX) return 'TOO_LONG';
  if (existing.some((p) => p.id !== exceptId && p.name === name)) return 'DUPLICATE';
  return null;
}

const LAYOUT_EPS = 1e-6;

/** 패드별 x·y·r이 모두 1e-6 이내로 같은지 */
export function layoutEquals(a: KitLayout, b: KitLayout): boolean {
  return ALL_PADS.every((id) => {
    const p = a[id];
    const q = b[id];
    return Math.abs(p.x - q.x) <= LAYOUT_EPS && Math.abs(p.y - q.y) <= LAYOUT_EPS && Math.abs(p.r - q.r) <= LAYOUT_EPS;
  });
}

/**
 * 현재 편집값이 적용 프리셋과 다른지.
 * 적용 프리셋이 없으면 저장되지 않은 편집값이 있는 셈이므로 true(저장할 것 있음).
 */
export function isDirty(current: { layout: KitLayout; soundSetId: SoundSetId }, preset: KitPreset | undefined): boolean {
  if (!preset) return true;
  return current.soundSetId !== preset.soundSetId || !layoutEquals(current.layout, preset.layout);
}
