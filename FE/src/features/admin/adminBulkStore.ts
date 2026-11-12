// 공용 곡 CSV 일괄 추가 실행 store (Jira 262 v0.3). 한 줄씩 차례로 등록 → 반주. 한 줄 실패가 다음 줄을 막지 않는다.
// 목록 재조회는 페이지가 끝난 뒤 adminSongStore.load로 한다(store끼리 import하지 않는다).
import { create } from 'zustand';
import { registerAdminSong, uploadAccompaniment } from './adminSongs';
import { ApiError } from '@/api/http';
import type { BulkRow } from './adminBulk';
import { adminErrorText, adminFailureText } from './adminSong';

export type BulkRowStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface BulkRowResult {
  status: BulkRowStatus;
  message: string | null;
}

interface AdminBulkState {
  phase: 'idle' | 'running' | 'done';
  /** CSV 줄 번호 → 결과 */
  results: Record<number, BulkRowResult>;
  summary: { done: number; failed: number; skipped: number };
  run: (rows: BulkRow[]) => Promise<void>;
  reset: () => void;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return adminFailureText(e.status, e.code);
  return adminErrorText('NETWORK');
}

async function runRow(row: BulkRow): Promise<BulkRowResult> {
  if (row.action === 'SKIP' || row.action === 'ERROR') return { status: 'skipped', message: null };
  if (row.action === 'ACCOMPANIMENT_ONLY') {
    if (row.songId === null || !row.draft.accompaniment) return { status: 'skipped', message: null };
    try {
      await uploadAccompaniment(row.songId, row.draft.accompaniment);
      return { status: 'done', message: null };
    } catch (e) {
      return { status: 'failed', message: errorText(e) };
    }
  }
  let id: number;
  try {
    id = (await registerAdminSong(row.draft)).id;
  } catch (e) {
    return { status: 'failed', message: errorText(e) };
  }
  if (row.draft.accompaniment) {
    try {
      await uploadAccompaniment(id, row.draft.accompaniment);
    } catch (e) {
      return { status: 'failed', message: `곡은 등록됐지만 반주를 올리지 못했어요. 다시 실행하면 반주만 올려요. (${errorText(e)})` };
    }
  }
  return { status: 'done', message: null };
}

const initial = { phase: 'idle' as const, results: {}, summary: { done: 0, failed: 0, skipped: 0 } };

export const useAdminBulk = create<AdminBulkState>()((set, get) => ({
  ...initial,

  run: async (rows) => {
    if (get().phase === 'running') return;
    set({ phase: 'running', results: {}, summary: { done: 0, failed: 0, skipped: 0 } });
    for (const row of rows) {
      set({ results: { ...get().results, [row.line]: { status: 'running', message: null } } });
      const result = await runRow(row);
      const summary = { ...get().summary };
      if (result.status === 'done') summary.done++;
      else if (result.status === 'failed') summary.failed++;
      else summary.skipped++;
      set({ results: { ...get().results, [row.line]: result }, summary });
    }
    set({ phase: 'done' });
  },

  reset: () => set({ ...initial }),
}));
