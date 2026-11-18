// 메뉴 hover·포커스 시 다음 화면의 코드와 대표 데이터를 미리 받는다 (설계 TECH-351 3절).
// 연주 중·데이터 절약·2G 이하·비로그인에서는 받지 않는다. 받은 데이터는 같은 30초 신선 규칙을 따른다.
import { DEFAULT_PLAY_LIST, playPageQuery } from '@/api/play/playQueries';
import { sheetListQuery } from '@/features/studio/api/queries/sheets';
import { mineSongsQuery, songListQuery } from '@/api/song/songQueries';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useShellStore } from '@/store/shellStore';
import { useRecordingStore } from '@/runtime/recordingStore';
import { useSongs } from '@/store/songStore';
import { SHEET_ARCHIVE_ENABLED } from '@/config/features';
import { queryClient } from '@/runtime/queryClient';
import { loadRoute, type RouteKey } from './routeModules';

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

function isPlaying(): boolean {
  return useShellStore.getState().immersive || useRecordingStore.getState().phase !== 'idle' || useLive.getState().metronome.playing;
}

/** 미리 받아도 되는지. `connection`이 없는 브라우저(Safari·Firefox)는 허용한다 */
export function canPrefetch(): boolean {
  if (useAuth.getState().status !== 'authenticated') return false;
  // 연주 중: 연주 화면(전체 화면)·녹음 중·메트로놈 재생 중
  if (isPlaying()) return false;
  const conn = (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: NetworkInfo }).connection : undefined) ?? undefined;
  if (conn?.saveData) return false;
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return false;
  return true;
}

const ROUTE_OF: Record<string, RouteKey> = {
  '/play': 'play',
  '/sheet': 'sheet',
  '/studio': 'studio',
  '/history': 'history',
  '/setup': 'setup',
  '/settings': 'settings',
  '/admin/songs': 'adminSongs',
};

/** 경로의 대표 데이터. 곡 선택은 SongPicker가 처음 읽는 조건(마지막 탭, 검색·난이도 없음)과 같은 키로 받는다 */
function prefetchData(path: string): void {
  const source = useSongs.getState().source;
  if (path === '/play' || path === '/sheet') {
    void queryClient.prefetchQuery(songListQuery({ scope: useSongs.getState().scope, q: '', playableOnly: true }, source));
  } else if (path === '/studio') {
    void queryClient.prefetchQuery(mineSongsQuery(source));
    if (SHEET_ARCHIVE_ENABLED) void queryClient.prefetchQuery(sheetListQuery());
  } else if (path === '/history') {
    const userId = useAuth.getState().user?.id;
    // 연주 기록 화면이 처음 읽는 조건(전체·최신순)의 첫 쪽
    if (userId != null) void queryClient.prefetchInfiniteQuery(playPageQuery(userId, DEFAULT_PLAY_LIST));
  }
}

/** 화면 코드와 대표 데이터를 미리 받는다. 금지 조건이면 아무것도 하지 않는다. 실패는 무시한다(실제 진입 때 다시 받는다) */
export function prefetchRoute(path: string): void {
  if (!canPrefetch()) return;
  const key = ROUTE_OF[path];
  if (key) void loadRoute(key).catch(() => {});
  prefetchData(path);
}
