// 프리셋 API (BE README "키트 프리셋 (90번)", 설계 SETUP-002 프리셋 서버연동 3-2·3-3).
// PresetSource의 서버 구현. 로그인 상태에서 app/presetBootstrap이 presetStore.setSource로 끼운다.
// 화면·store는 이 파일을 직접 부르지 않는다. 요청·응답에 calibration은 없다(명세 미결 #23: FE가 쓰지 않음).
import { fillLayout, type KitLayout, type PadPlacement } from '@/domain/kit/kitLayout';
import { normalizePadKeys } from '@/domain/kit/pads';
import {
  PRESET_SCHEMA_VERSION,
  PresetError,
  type KitPreset,
  type PresetDraft,
  type PresetErrorCode,
  type PresetSource,
} from '@/domain/kit/preset';
import type { SoundSetId } from '@/domain/kit/soundSet';
import { ApiError, apiFetch } from '@/api/http';

/** BE 응답. 응답에 `calibration`(V11, 항상 null)이 와도 읽지 않으므로 타입에 두지 않는다 */
export interface PresetDto {
  id: number;
  name: string;
  isDefault: boolean;
  /** 서버가 옛 패드 이름(HI_TOM)·빠진 패드로 보낼 수 있어 키를 느슨하게 둔다. toKitPreset이 보정한다 */
  layout: Record<string, PadPlacement>;
  /** 1단계는 soundSetId 하나. BE는 내용을 해석하지 않으므로 모르는 값이 올 수 있다 */
  sounds: { soundSetId?: string };
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** 생성·수정 본문. BE는 세 JSON 형식을 해석하지 않고 객체 여부·크기만 본다 */
interface PresetBody {
  name: string;
  layout: KitLayout;
  sounds: { soundSetId: SoundSetId };
  schemaVersion: number;
}

/** BE 도메인 오류 코드 → PresetError.code. 표에 없는 코드는 NETWORK */
const ERROR_CODES: Record<string, PresetErrorCode> = {
  PRESET_NAME_DUPLICATE: 'NAME_DUPLICATE',
  PRESET_LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  PRESET_NOT_FOUND: 'NOT_FOUND',
  PRESET_CONFLICT: 'CONFLICT',
};

/** 서버 값이 FE가 아는 세트가 아니면 기본 세트로(settingsStore v8 마이그레이션과 같은 규칙) */
function toSoundSetId(raw: unknown): SoundSetId {
  return raw === 'synth' || raw === 'ssaplash' ? raw : 'ssaplash';
}

/** BE 응답 → 화면 프리셋. id는 문자열(로컬 id와 같은 타입), sounds.soundSetId는 한 단계 올린다 */
export function toKitPreset(dto: PresetDto): KitPreset {
  return {
    id: String(dto.id),
    name: dto.name,
    isDefault: dto.isDefault,
    layout: fillLayout(normalizePadKeys(dto.layout)),
    soundSetId: toSoundSetId(dto.sounds?.soundSetId),
    schemaVersion: dto.schemaVersion,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function toBody(draft: PresetDraft): PresetBody {
  return {
    name: draft.name,
    layout: draft.layout,
    sounds: { soundSetId: draft.soundSetId },
    schemaVersion: PRESET_SCHEMA_VERSION,
  };
}

/**
 * 호출 실패를 PresetError로 바꾼다. ApiError는 코드 표로 옮기고(메시지는 BE detail),
 * 네트워크(status 0)·5xx·표에 없는 4xx·그 밖의 예외는 모두 NETWORK다(요청서 합의).
 */
export function toPresetError(e: unknown): PresetError {
  if (e instanceof PresetError) return e;
  if (e instanceof ApiError) return new PresetError(ERROR_CODES[e.code] ?? 'NETWORK', e.detail);
  return new PresetError('NETWORK', e instanceof Error ? e.message : undefined);
}

async function call<T>(job: () => Promise<T>): Promise<T> {
  try {
    return await job();
  } catch (e) {
    throw toPresetError(e);
  }
}

const path = (id: string, suffix = '') => `/api/presets/${encodeURIComponent(id)}${suffix}`;

export class ServerPresetSource implements PresetSource {
  /** `GET /api/presets`. BE가 기본 프리셋 먼저, 그다음 최근 생성 순으로 준다 */
  list(): Promise<KitPreset[]> {
    return call(async () => (await apiFetch<PresetDto[]>('/api/presets')).map(toKitPreset));
  }

  /** `POST /api/presets` 201. 첫 프리셋도 기본이 아니므로 presetStore.saveAs가 setDefault를 이어 부른다 */
  create(draft: PresetDraft): Promise<KitPreset> {
    return call(async () => toKitPreset(await apiFetch<PresetDto>('/api/presets', { method: 'POST', body: toBody(draft) })));
  }

  /** `PUT /api/presets/{id}` 200. 내용 전체를 덮어쓰고 기본 여부는 그대로 */
  update(id: string, draft: PresetDraft): Promise<KitPreset> {
    return call(async () => toKitPreset(await apiFetch<PresetDto>(path(id), { method: 'PUT', body: toBody(draft) })));
  }

  /** `DELETE /api/presets/{id}` 204. 기본을 지우면 BE가 남은 것 중 최근 생성을 기본으로 올린다 */
  remove(id: string): Promise<void> {
    return call(() => apiFetch<void>(path(id), { method: 'DELETE' }));
  }

  /** `PUT /api/presets/{id}/default` 200. 이전 기본은 해제된다(멱등) */
  setDefault(id: string): Promise<KitPreset> {
    return call(async () => toKitPreset(await apiFetch<PresetDto>(path(id, '/default'), { method: 'PUT' })));
  }
}
