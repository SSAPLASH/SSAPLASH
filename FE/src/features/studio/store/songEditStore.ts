// 곡 편집 1회 실행 store (설계 CHART-001 3-3). 표시명·커버·삭제 각각 요청 한 번. 창 닫기·목록 재조회는 하지 않는다 — 페이지가 접착한다.
import { create } from 'zustand';
import { ApiError } from '@/api/http';
import { deleteSong, deleteSongCover, updateSongMeta, uploadSongCover } from '@/api/song/songs';
import type { CoverChange } from '@/features/studio/domain/songCover';
import { songEditFailure, type SongMetaPatch } from '@/domain/song/songEdit';

export type SongEditPhase = 'idle' | 'saving' | 'done' | 'failed';

export interface SongEditError {
  code: string;
  text: string;
  /** 서버에 반영됐는지 모르는 실패(네트워크·5xx·알 수 없는 코드). 페이지가 목록을 다시 읽는다 */
  uncertain: boolean;
}

interface SongEditState {
  phase: SongEditPhase;
  error: SongEditError | null;
  saveMeta: (id: number, patch: SongMetaPatch) => Promise<void>;
  saveCover: (id: number, change: CoverChange) => Promise<void>;
  remove: (id: number) => Promise<void>;
  reset: () => void;
}

export const useSongEdit = create<SongEditState>()((set, get) => {
  // 세 동작이 같은 잠금·오류 처리를 쓴다. 실행 중 재호출은 무시한다
  async function run(request: () => Promise<unknown>): Promise<void> {
    if (get().phase === 'saving') return;
    set({ phase: 'saving', error: null });
    try {
      await request();
      set({ phase: 'done', error: null });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      // 5xx는 코드가 있어도 결과를 알 수 없다(저장소 장애 COVER_UNAVAILABLE만 저장 전 실패로 확실)
      const { text, uncertain } = songEditFailure(e instanceof ApiError ? e.status : 0, code);
      set({ phase: 'failed', error: { code, text, uncertain } });
    }
  }

  return {
    phase: 'idle',
    error: null,
    saveMeta: (id, patch) => run(() => updateSongMeta(id, patch)),
    saveCover: (id, change) => run(() => (change.kind === 'set' ? uploadSongCover(id, change.blob) : deleteSongCover(id))),
    remove: (id) => run(() => deleteSong(id)),
    reset: () => set({ phase: 'idle', error: null }),
  };
});
