// MIDI·MusicXML 업로드 1회 실행 store (설계 CHART-002 3-4, 293). 화면 이동·목록 재조회는 하지 않는다 — 페이지가 접착한다.
// 293: 파일 확장자로 MIDI(/songs/midi)와 MusicXML(/songs/musicxml)을 가른다. 응답 모양과 오류 처리는 같다.
import { create } from 'zustand';
import { ApiError } from '@/api/http';
import { uploadMidi, uploadMusicXml } from '@/api/song/songs';
import { MIDI_PRECHECK_TEXT, isMidiUncertain, midiErrorText, precheckUpload, type MidiDraft } from '@/domain/song/midiUpload';
import type { SongDetail } from '@/domain/song/songCatalog';

export type MidiUploadPhase = 'idle' | 'uploading' | 'done' | 'failed';

export interface MidiUploadError {
  code: string;
  text: string;
  /** 서버에 저장됐는지 모르는 실패(네트워크·5xx·알 수 없는 코드). 페이지가 목록을 다시 읽는다 */
  uncertain: boolean;
}

interface MidiUploadState {
  phase: MidiUploadPhase;
  song: SongDetail | null;
  error: MidiUploadError | null;
  upload: (draft: MidiDraft) => Promise<void>;
  reset: () => void;
}

export const useMidiUpload = create<MidiUploadState>()((set, get) => ({
  phase: 'idle',
  song: null,
  error: null,

  upload: async (draft) => {
    if (get().phase === 'uploading') return;
    const check = precheckUpload(draft.file);
    if (!check.ok) {
      set({ phase: 'failed', song: null, error: { code: check.reason, text: MIDI_PRECHECK_TEXT[check.reason], uncertain: false } });
      return;
    }
    set({ phase: 'uploading', song: null, error: null });
    try {
      const song = await (check.kind === 'MUSICXML' ? uploadMusicXml(draft) : uploadMidi(draft));
      set({ phase: 'done', song, error: null });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      const detail = e instanceof ApiError ? e.detail : null;
      // 5xx는 코드가 있어도 결과를 알 수 없다. 예외: MUSICXML_UNAVAILABLE(503)은 BE가 곡을 만들지 않은 것이 확실하다(293)
      const serverError = e instanceof ApiError && e.status >= 500 && code !== 'MUSICXML_UNAVAILABLE';
      const uncertain = serverError || isMidiUncertain(code);
      const text = serverError ? midiErrorText('HTTP_ERROR', null) : midiErrorText(code, detail);
      set({ phase: 'failed', song: null, error: { code, text, uncertain } });
    }
  },

  reset: () => set({ phase: 'idle', song: null, error: null }),
}));
