// 연속 그림(스프라이트 시트) 보관소 — 묶음 불러오기·디코드·보관·해제. 무엇을 언제 그릴지는 모른다.
// 소유자(엔진 등)마다 "내가 쓰는 묶음 목록"을 통째로 알리고, 어느 소유자도 쓰지 않는 묶음은 버린다.
import { SHEET_DEFS } from '@/domain/hitFx/sheets';
import type { FxSheetId } from '@/domain/hitFx/types';

export interface FxSheetStore {
  /** 이 소유자가 쓰는 묶음 목록을 통째로 바꾼다. 아무도 쓰지 않는 묶음은 버리고, 새로 필요한 것은 불러와 디코드한다 */
  use(owner: object, ids: readonly FxSheetId[]): void;
  /** 모두 디코드됐으면 true. 빈 목록은 true */
  ready(ids: readonly FxSheetId[]): boolean;
  /** 디코드된 그림. 없으면 null */
  get(id: FxSheetId): CanvasImageSource | null;
}

/** 그림 하나를 받아 디코드한다. 실패하면 reject */
export type FxSheetLoader = (src: string) => Promise<CanvasImageSource>;

export interface FxSheetStoreOptions {
  load?: FxSheetLoader;
  /** false면 아무것도 불러오지 않는다(항상 not ready → 입자 이펙트) */
  enabled?: boolean;
}

/** 기기 메모리(GB)가 이 값 미만이면 그림을 불러오지 않는다(25MB~ 펼침 비용) */
export const MIN_DEVICE_MEMORY_GB = 4;

interface Entry {
  /** 디코드가 끝나면 채워진다. 그 전에는 null */
  image: CanvasImageSource | null;
}

function browserLoader(src: string): Promise<CanvasImageSource> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => img);
}

/** 이 환경에서 그림을 불러와도 되는지: Image가 있고 기기 메모리가 작지 않을 때 */
function canLoadSheets(): boolean {
  // jsdom 같은 환경에는 Image는 있어도 decode가 없다
  if (typeof Image === 'undefined' || typeof Image.prototype.decode !== 'function') return false;
  const mem = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return !(typeof mem === 'number' && mem < MIN_DEVICE_MEMORY_GB);
}

export function createFxSheetStore(options: FxSheetStoreOptions = {}): FxSheetStore {
  const enabled = options.enabled ?? canLoadSheets();
  const load = options.load ?? browserLoader;
  const owners = new Map<object, ReadonlySet<FxSheetId>>();
  const entries = new Map<FxSheetId, Entry>();

  function start(id: FxSheetId) {
    const entry: Entry = { image: null };
    entries.set(id, entry);
    // load가 동기로 던져도 실패로 다룬다
    Promise.resolve()
      .then(() => load(SHEET_DEFS[id].src))
      .then(
        (image) => {
          // 그동안 버려졌거나 다시 만들어졌으면 이 결과는 무시한다
          if (entries.get(id) === entry) entry.image = image;
        },
        () => {
          // 실패는 "없음"으로 두고 다음 use에서 다시 시도한다
          if (entries.get(id) === entry) entries.delete(id);
        },
      );
  }

  return {
    use(owner, ids) {
      if (ids.length === 0) owners.delete(owner);
      else owners.set(owner, new Set(ids));
      if (!enabled) return;
      const wanted = new Set<FxSheetId>();
      for (const set of owners.values()) for (const id of set) wanted.add(id);
      for (const id of [...entries.keys()]) if (!wanted.has(id)) entries.delete(id);
      for (const id of wanted) if (!entries.has(id)) start(id);
    },
    ready(ids) {
      for (const id of ids) if (!entries.get(id)?.image) return false;
      return true;
    },
    get(id) {
      return entries.get(id)?.image ?? null;
    },
  };
}

/** 앱에 하나인 기본 보관소. 캔버스가 여러 개여도 같은 그림을 나눠 쓴다 */
export const fxSheets: FxSheetStore = createFxSheetStore();
