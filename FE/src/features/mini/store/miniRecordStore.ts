// 미니게임 최고 기록 보관·저장 (설계 MODE-006-minigame-speed 3절 「저장 형식」). zustand + localStorage, 계정별 키.
// 한 브라우저를 여러 계정이 써도 섞이지 않게 플레이 로그(engine/playLog)와 같은 방식으로 키 뒤에 `.u{userId}`를 붙인다.
// 서버에는 저장하지 않는다(범위 밖). 저장하지 못해도 그 판의 결과 화면은 그대로 보여야 하므로 예외를 삼킨다.
import { create } from 'zustand';
import type { MiniGameId } from '@/domain/play/miniGame';
import { useAuth } from '@/store/authStore';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { isNewBest, parseRecords, recordKey, serializeRecords, type MiniRecord, type MiniRecords } from '@/features/mini/domain/miniRecord';

/** 비로그인(인증 끔 개발 모드)의 저장 키. 계정 기록은 뒤에 `.u{userId}`를 붙여 따로 둔다 */
const BASE_KEY = 'ssaplash.mini.v1';

function storageKey(userId: number | null): string {
  return userId === null ? BASE_KEY : `${BASE_KEY}.u${userId}`;
}

/** 깨진 값·읽기 실패는 기록 없음으로 본다 */
function read(userId: number | null): MiniRecords {
  try {
    return parseRecords(localStorage.getItem(storageKey(userId)));
  } catch {
    return {};
  }
}

function write(userId: number | null, records: MiniRecords): void {
  try {
    localStorage.setItem(storageKey(userId), serializeRecords(records));
  } catch {
    // 저장 공간이 막혔거나 가득 찼다. 이번 접속의 기록은 메모리에 남는다
  }
}

function currentOwner(): number | null {
  return useAuth.getState().user?.id ?? null;
}

/** `submit` 결과. `previous`는 이 판 전의 최고 기록(없으면 null)이다 */
export interface MiniSubmitResult {
  updated: boolean;
  previous: MiniRecord | null;
}

interface MiniRecordState {
  /** 지금 읽어 둔 기록의 주인(로그인 계정 id, 없으면 null) */
  owner: number | null;
  records: MiniRecords;
  /** 최고 기록. 없으면 null. 갈래가 없는 게임은 갈래를 넘기지 않는다 */
  best: (gameId: MiniGameId, variant?: string) => MiniRecord | null;
  /** 같은 게임·같은 갈래의 기록과 견줘 더 좋으면 바꾸고 저장한다. 동점은 갱신이 아니다 */
  submit: (record: MiniRecord) => MiniSubmitResult;
  /** 저장소에서 다시 읽는다. 화면이 열릴 때 부른다(다른 탭에서 바뀐 기록 반영) */
  reload: () => void;
}

export const useMiniRecords = create<MiniRecordState>((set, get) => {
  const owner = currentOwner();
  return {
    owner,
    records: read(owner),
    best: (gameId, variant) => get().records[recordKey(gameId, variant)] ?? null,
    submit: (record) => {
      const key = recordKey(record.gameId, record.variant);
      const previous = get().records[key] ?? null;
      if (!isNewBest(previous, record.score, miniGameInfo(record.gameId).better)) return { updated: false, previous };
      const records = { ...get().records, [key]: record };
      set({ records });
      write(get().owner, records);
      return { updated: true, previous };
    },
    reload: () => {
      const next = currentOwner();
      set({ owner: next, records: read(next) });
    },
  };
});

// 계정이 바뀌면(로그인·로그아웃·계정 전환) 그 계정의 키에서 다시 읽는다
useAuth.subscribe((state) => {
  const owner = state.user?.id ?? null;
  if (owner !== useMiniRecords.getState().owner) useMiniRecords.setState({ owner, records: read(owner) });
});
