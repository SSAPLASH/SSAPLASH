// 악보 나중 연결 흐름 store (설계 CHART-001 D16·D17, T12). 악보만 항목의 [곡 올리기] → 곡 등록 직후 PATCH {songId} 1회.
// 화면 이동·목록 재조회·토스트는 하지 않는다 — 페이지(StudioPage)가 접착한다. 재시도 대상은 메모리에만 둔다(새로고침하면 사라진다).
import { create } from 'zustand';
import { linkSheetToSong } from '@/features/studio/api/sheets';
import { SheetError, sheetErrorText, type SheetSummary } from '@/features/studio/domain/sheetMusic';

export type SheetLinkPhase = 'idle' | 'linking' | 'done' | 'failed';

interface SheetLinkState {
  /** 곡 올리기를 누른 악보. 곡이 등록되면 이 악보에 연결한다 */
  target: SheetSummary | null;
  /** 연결에 실패해 [다시 연결]로 PATCH만 되풀이할 대상 */
  pending: { sheetId: number; songId: number } | null;
  phase: SheetLinkPhase;
  error: string | null;
  /** [곡 올리기]를 누른 악보를 지정한다 */
  begin: (sheet: SheetSummary) => void;
  /** target 악보를 곡에 연결한다. target이 없거나 이미 연결 중이면 아무것도 하지 않는다 */
  link: (songId: number) => Promise<void>;
  /** pending 대상만 다시 PATCH한다(곡을 다시 올리지 않는다) */
  retry: () => Promise<void>;
  /** 대상 지정만 해제한다(창을 닫거나 다른 경로로 열 때). 실패 대상(pending)은 남는다 */
  cancel: () => void;
  reset: () => void;
}

/** PATCH 한 번. 성공하면 true */
async function patch(sheetId: number, songId: number, set: (p: Partial<SheetLinkState>) => void): Promise<boolean> {
  set({ phase: 'linking', error: null });
  try {
    await linkSheetToSong(sheetId, songId);
    set({ phase: 'done', target: null, pending: null, error: null });
    return true;
  } catch (e) {
    const code = e instanceof SheetError ? e.code : 'NETWORK';
    // 창은 이미 닫혔으므로 대상 지정은 풀고, 곡은 남았으니 다시 연결할 대상만 보관한다
    set({ phase: 'failed', target: null, pending: { sheetId, songId }, error: sheetErrorText(code) });
    return false;
  }
}

export const useSheetLink = create<SheetLinkState>()((set, get) => ({
  target: null,
  pending: null,
  phase: 'idle',
  error: null,

  // 이전 시도의 결과(done·failed)가 이번 시도로 새지 않게 phase·error는 비운다. 실패 대상(pending)은 그대로 둔다
  begin: (sheet) => set({ target: sheet, phase: 'idle', error: null }),

  link: async (songId) => {
    const { target, phase } = get();
    if (!target || phase === 'linking') return;
    await patch(target.id, songId, set);
  },

  retry: async () => {
    const { pending, phase } = get();
    if (!pending || phase === 'linking') return;
    await patch(pending.sheetId, pending.songId, set);
  },

  cancel: () => set({ target: null }),

  reset: () => set({ target: null, pending: null, phase: 'idle', error: null }),
}));
