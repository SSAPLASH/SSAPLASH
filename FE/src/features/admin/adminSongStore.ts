// 관리자 공용 곡 관리 store (Jira 262). 목록·등록(+선택 반주)·행별 반주 업로드. 화면 이동은 하지 않는다 — 페이지가 접착한다.
import { create } from 'zustand';
import { listAllAdminSongs, registerAdminSong, uploadAccompaniment } from './adminSongs';
import { ApiError } from '@/api/http';
import {
  ACCOMPANIMENT_PRECHECK_TEXT,
  ADMIN_DRAFT_TEXT,
  adminErrorText,
  adminFailureText,
  precheckAccompaniment,
  validateAdminDraft,
  type AdminSong,
  type AdminSongDraft,
} from './adminSong';

export type AdminSongsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** done: 등록(+반주) 성공 · partial: 곡은 등록됐고 반주만 실패 · invalid: 요청 전 검사 실패 · failed: 등록 실패 */
export interface RegisterOutcome {
  result: 'done' | 'partial' | 'invalid' | 'failed';
  message: string | null;
}

interface AdminSongsState {
  status: AdminSongsStatus;
  songs: AdminSong[];
  loadError: string | null;
  saving: boolean;
  /** 반주 업로드 중인 곡 id */
  uploading: Record<number, true>;
  /** 곡 id → 마지막 반주 업로드 실패 문구 */
  rowErrors: Record<number, string>;
  load: () => Promise<void>;
  register: (draft: AdminSongDraft) => Promise<RegisterOutcome>;
  uploadFor: (id: number, file: File) => Promise<void>;
  resetForTest: () => void;
}

/** 5xx·네트워크는 저장됐는지 모르므로 "결과 미확인" 문구, 그 밖은 서버 코드 문구 */
function errorText(e: unknown): string {
  if (e instanceof ApiError) return adminFailureText(e.status, e.code);
  return adminErrorText('NETWORK');
}

const initial = { status: 'idle' as AdminSongsStatus, songs: [] as AdminSong[], loadError: null, saving: false, uploading: {}, rowErrors: {} };

export const useAdminSongs = create<AdminSongsState>()((set, get) => ({
  ...initial,

  load: async () => {
    set({ status: 'loading', loadError: null });
    try {
      const songs = await listAllAdminSongs();
      set({ status: 'ready', songs });
    } catch (e) {
      set({ status: 'error', loadError: errorText(e) });
    }
  },

  register: async (draft) => {
    if (get().saving) return { result: 'failed', message: null };
    const check = validateAdminDraft(draft);
    if (!check.ok) return { result: 'invalid', message: ADMIN_DRAFT_TEXT[check.reason] };
    set({ saving: true });
    try {
      let song: AdminSong;
      try {
        song = await registerAdminSong(draft);
      } catch (e) {
        // 5xx·네트워크(ApiError 0)는 등록됐을 수도 있어 목록을 다시 읽는다
        if (!(e instanceof ApiError) || e.status >= 500 || e.status === 0) await get().load();
        return { result: 'failed', message: errorText(e) };
      }
      let outcome: RegisterOutcome = { result: 'done', message: null };
      if (draft.accompaniment) {
        try {
          await uploadAccompaniment(song.id, draft.accompaniment);
        } catch (e) {
          outcome = { result: 'partial', message: `「${song.title}」은 등록됐지만 반주를 올리지 못했어요. 표에서 다시 올려 주세요. (${errorText(e)})` };
        }
      }
      await get().load();
      return outcome;
    } finally {
      set({ saving: false });
    }
  },

  uploadFor: async (id, file) => {
    if (get().uploading[id]) return;
    const clearError = () => {
      const { [id]: _, ...rest } = get().rowErrors;
      return rest;
    };
    const check = precheckAccompaniment(file);
    if (!check.ok) {
      set({ rowErrors: { ...get().rowErrors, [id]: ACCOMPANIMENT_PRECHECK_TEXT[check.reason] } });
      return;
    }
    set({ uploading: { ...get().uploading, [id]: true }, rowErrors: clearError() });
    try {
      await uploadAccompaniment(id, file);
      set({ songs: get().songs.map((s) => (s.id === id ? { ...s, hasAccompaniment: true } : s)) });
    } catch (e) {
      set({ rowErrors: { ...get().rowErrors, [id]: errorText(e) } });
    } finally {
      const { [id]: _, ...rest } = get().uploading;
      set({ uploading: rest });
    }
  },

  resetForTest: () => set({ ...initial }),
}));
