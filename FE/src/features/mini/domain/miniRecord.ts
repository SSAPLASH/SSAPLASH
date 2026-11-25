// 미니게임 최고 기록의 타입·갱신 판정·저장 값 검증 (설계 MODE-006-minigame-speed 3절). localStorage에는 접근하지 않는다(store가 한다).
// 기록은 게임마다 하나, 갈래가 있는 게임은 갈래마다 하나다(D13). `detail`은 게임마다 모양이 달라 검증을 게임 id별 표로 둔다.
import type { MiniGameId } from '@/domain/play/miniGame';
import { isDynamicsDetail, type DynamicsDetail } from './dynamicsRound';
import { isSightDetail, type SightDetail } from './sightRound';
import { isSpeedDetail, type SpeedDetail } from './speedRound';

/** 값이 클수록 좋은 기록인가. 반응 시간·오차를 재는 게임은 `lower` */
export type MiniBetter = 'higher' | 'lower';

/** 게임별 `detail` 모양. 뒤의 게임이 한 줄을 더한다 */
interface MiniDetailMap {
  speed: SpeedDetail;
  dynamics: DynamicsDetail;
  sight: SightDetail;
}

/** 게임별 `detail` 검증. 뒤의 게임이 한 줄을 더한다 */
const DETAIL_GUARDS: { [G in MiniGameId]: (detail: unknown) => detail is MiniDetailMap[G] } = {
  speed: isSpeedDetail,
  dynamics: isDynamicsDetail,
  sight: isSightDetail,
};

/** 한 게임(또는 한 갈래)의 최고 기록 */
export type MiniRecord = {
  [G in MiniGameId]: {
    gameId: G;
    /** 기록의 갈래. 갈래가 없는 게임은 두지 않는다 */
    variant?: string;
    score: number;
    /** 기록한 때(ISO 시각 문자열) */
    at: string;
    detail: MiniDetailMap[G];
  };
}[MiniGameId];

/** 최고 기록 묶음. 키는 `recordKey` */
export type MiniRecords = Record<string, MiniRecord>;

/** 저장 형식 버전. 저장 키의 `v1`과 같이 올린다 */
const VERSION = 1;

/** 이전 기록이 없거나 더 좋은 값이면 참. 동점은 갱신이 아니다 */
export function isNewBest(previous: Pick<MiniRecord, 'score'> | null | undefined, score: number, better: MiniBetter): boolean {
  if (!previous) return true;
  return better === 'higher' ? score > previous.score : score < previous.score;
}

/** 저장 묶음의 키. 갈래가 없으면 게임 id, 있으면 `게임 id:갈래` */
export function recordKey(gameId: MiniGameId, variant?: string): string {
  return variant === undefined ? gameId : `${gameId}:${variant}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGameId(value: unknown): value is MiniGameId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DETAIL_GUARDS, value);
}

/** 한 기록의 형식이 맞으면 그 기록을, 아니면 null을 돌려준다 */
function parseRecord(value: unknown): MiniRecord | null {
  if (!isObject(value)) return null;
  const { gameId, variant, score, at, detail } = value;
  if (!isGameId(gameId)) return null;
  if (variant !== undefined && (typeof variant !== 'string' || variant === '')) return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (!DETAIL_GUARDS[gameId](detail)) return null;
  // 검증 표가 게임 id와 `detail` 모양의 짝을 보장한다(타입은 둘의 짝을 따라가지 못해 단언한다)
  return (variant === undefined ? { gameId, score, at, detail } : { gameId, variant, score, at, detail }) as MiniRecord;
}

/**
 * 저장 문자열 → 기록 묶음. 형식이 맞는 기록만 돌려준다.
 * 통째로 깨졌거나 버전이 다르면 빈 값이고, 한 기록만 맞지 않으면(`detail`이 깨진 경우 등) 그 기록만 버리고 나머지는 살린다
 */
export function parseRecords(raw: string | null | undefined): MiniRecords {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(data) || data.v !== VERSION || !isObject(data.records)) return {};
  const records: MiniRecords = {};
  for (const [key, value] of Object.entries(data.records)) {
    const record = parseRecord(value);
    // 키와 내용이 어긋난 값은 믿지 않는다
    if (record && recordKey(record.gameId, record.variant) === key) records[key] = record;
  }
  return records;
}

/** 기록 묶음 → 저장 문자열 */
export function serializeRecords(records: MiniRecords): string {
  return JSON.stringify({ v: VERSION, records });
}

/**
 * 목록 카드에 보일 기록. 갈래가 없는 게임은 그 게임의 기록이고, 갈래가 있는 게임은 갈래 순서대로 처음 있는 기록이다.
 * 첫 갈래가 아닌 기록이면 카드가 꼬리말로 붙일 갈래 이름(`variantName`)을 같이 돌려준다
 */
export function cardRecord(
  records: MiniRecords,
  gameId: MiniGameId,
  variants?: readonly { id: string; name: string }[],
): { record: MiniRecord; variantName?: string } | null {
  if (!variants || variants.length === 0) {
    const record = records[recordKey(gameId)];
    return record ? { record } : null;
  }
  for (let i = 0; i < variants.length; i += 1) {
    const record = records[recordKey(gameId, variants[i].id)];
    if (record) return i === 0 ? { record } : { record, variantName: variants[i].name };
  }
  return null;
}
