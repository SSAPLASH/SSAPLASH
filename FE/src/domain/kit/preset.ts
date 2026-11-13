// 키트 프리셋 도메인: 타입·상수·이름 검증·변경 여부 판정. 저장소(로컬/서버)는 PresetSource 뒤에 둔다.
// 시스템 기본(SYSTEM_PRESET_ID)은 목록에 없는 예약 프리셋이다(UX-64 D1): 고정 배치 + 3D 모델 기본 앵커, 편집 불가.
import type { HandAnchors } from './calibration/calibration';
import type { KitLayout } from './kitLayout';
import { ALL_PADS } from './pads';
// 타입만 가져온다(런타임 의존 없음). 사운드 세트 id의 주인은 audio/soundSets
import type { SoundSetId } from './soundSet';

/** 프리셋 상한(BE와 동일) */
export const MAX_PRESETS = 10;
/** 드럼 세팅 슬롯 창의 저장 슬롯 수(Figma 772:33828, UX-64 U9). 0번 시스템 기본은 따로 */
export const PRESET_SLOTS = 5;
/** 시스템 기본 프리셋의 예약 id. 목록(PresetSource)에는 없다 */
export const SYSTEM_PRESET_ID = 'system';
export const SYSTEM_PRESET_NAME = '시스템 기본';

export function isSystemPreset(id: string | null | undefined): boolean {
  return id === SYSTEM_PRESET_ID;
}

/** 적용 프리셋 표시 이름. 시스템 기본이면 고정 이름, 목록에 없으면 null */
export function presetDisplayName(presets: readonly { id: string; name: string }[], id: string | null): string | null {
  if (isSystemPreset(id)) return SYSTEM_PRESET_NAME;
  return presets.find((p) => p.id === id)?.name ?? null;
}

/** 프리셋 하나의 손별 앵커(기기 로컬, UX-64 D2). 서버 프리셋 스키마에는 없다 */
export interface PresetAnchorRecord {
  anchors: HandAnchors;
  /** 보정 시각(Date.now) */
  calibratedAt: number;
}

/** 프리셋 id → 앵커. 다른 기기에서 만든 프리셋은 항목이 없다(모델 기본 앵커로 판정) */
export type PresetAnchors = Record<string, PresetAnchorRecord>;

/** 'new' 보정(추가하기)의 결과. 저장 전까지 아무것도 바꾸지 않는다(UX-64 D4) */
export interface CaptureDraft {
  anchors: HandAnchors;
  layout: KitLayout;
  calibratedAt: number;
}
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
