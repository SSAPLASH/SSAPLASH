// 라이브러리 곡 재생바 상태 (설계 CHART-003 라이브러리 재생바 3절). 페이지가 만들어 목록 → 카드·줄로 내려보낸다.
import { pickableForAccompaniment, type AccompanimentBarView } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';

/** 페이지가 목록 → 카드·줄로 내려보내는 듣기 상태와 조작 */
export interface SongPlayback {
  /** 지금 재생기 상태. view.pick.songId가 재생 대상 곡 */
  view: AccompanimentBarView;
  /** 쉬는 재생바의 ▶: 이 곡을 재생 대상으로 불러와 재생한다(다른 곡은 꺼진다) */
  onListen: (song: SongSummary) => void;
  onPause: () => void;
  onResume: () => void;
  onSeek: (ms: number) => void;
  onRetry: () => void;
}

/** 곡 READY + 반주 READY인 곡만 들을 수 있다(D2) */
export function canListen(song: SongSummary): boolean {
  return pickableForAccompaniment(song) === 'ready';
}

/** 이 곡이 지금 재생 대상인지(불러오는 중·일시정지·오류 포함) */
export function isListening(playback: SongPlayback | undefined, songId: number): boolean {
  return playback !== undefined && playback.view.phase !== 'none' && playback.view.pick?.songId === songId;
}

/** 이 곡이 지금 소리를 내고 있는지. 제목은 이때만 흐른다(D5) */
export function isSounding(playback: SongPlayback | undefined, songId: number): boolean {
  return isListening(playback, songId) && playback?.view.phase === 'playing';
}
