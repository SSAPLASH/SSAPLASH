// 곡 즐겨찾기 읽기·바꾸기 (설계 MODE-001-MODE-003-song-favorite 3·4절).
// 별은 누르는 즉시 바뀌고 저장은 뒤에서 한다. 저장에 실패하면 원래대로 되돌리고 onError를 부른다.
// 저장 위치: FAVORITES_REMOTE가 참이고 곡 소스가 api면 서버, 그 밖에는 브라우저(favoriteStorage).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { addFavoriteSong, listFavoriteSongIds, removeFavoriteSong } from '@/api/song/favorites';
import { songKeys } from '@/api/song/songQueries';
import { FAVORITES_REMOTE } from '@/config/favorites';
import { withFavorite } from '@/features/play/domain/favoriteFilter';
import { readLocalFavorites, writeLocalFavorites } from '@/features/play/favoriteStorage';
import { queryClient } from '@/runtime/queryClient';
import { useApiQuery, type ApiQueryStatus } from '@/runtime/useApiQuery';
import { useAuth } from '@/store/authStore';
import type { SongsSource } from '@/store/songStore';

export interface SongFavorites {
  /** 즐겨찾기한 곡 id. 아직 못 읽었거나 읽기에 실패했으면 빈 집합 */
  ids: ReadonlySet<number>;
  status: ApiQueryStatus;
  /** 그 곡의 즐겨찾기를 뒤집는다 */
  toggle: (songId: number) => void;
}

/** 곡마다 진행 중인 저장. want는 마지막으로 누른 상태, saved는 서버가 아는 상태 */
interface Job {
  want: boolean;
  saved: boolean;
}

const NO_IDS: readonly number[] = [];

export function useSongFavorites(source: SongsSource, onError: () => void): SongFavorites {
  const authed = useAuth((a) => a.status === 'authenticated');
  const remote = FAVORITES_REMOTE && source === 'api';
  const key = useMemo(() => songKeys.favorites(remote), [remote]);
  const query = useApiQuery<readonly number[]>({
    queryKey: key,
    queryFn: ({ signal }) => (remote ? listFavoriteSongIds(signal) : Promise.resolve(readLocalFavorites())),
    enabled: !remote || authed,
  });
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const jobs = useRef(new Map<number, Job>());

  const toggle = useCallback(
    (songId: number) => {
      const current = queryClient.getQueryData<readonly number[]>(key) ?? NO_IDS;
      const next = !current.includes(songId);
      const set = (on: boolean) => queryClient.setQueryData<readonly number[]>(key, (ids) => withFavorite(ids ?? NO_IDS, songId, on));
      // 읽는 중인 응답이 방금 누른 상태를 덮지 않게 한다
      void queryClient.cancelQueries({ queryKey: key });
      set(next);

      if (!remote) {
        if (!writeLocalFavorites(queryClient.getQueryData<readonly number[]>(key) ?? NO_IDS)) {
          set(!next);
          onErrorRef.current();
        }
        return;
      }

      // 같은 곡을 저장하는 중이면 끝난 뒤 마지막 상태로 한 번 더 맞춘다
      const running = jobs.current.get(songId);
      if (running) {
        running.want = next;
        return;
      }
      const job: Job = { want: next, saved: !next };
      jobs.current.set(songId, job);
      void (async () => {
        try {
          while (job.want !== job.saved) {
            const want = job.want;
            await (want ? addFavoriteSong(songId) : removeFavoriteSong(songId));
            job.saved = want;
          }
        } catch {
          set(job.saved);
          onErrorRef.current();
        } finally {
          jobs.current.delete(songId);
          // 저장이 모두 끝나면 서버 목록과 다시 맞춘다
          if (jobs.current.size === 0) void queryClient.invalidateQueries({ queryKey: key });
        }
      })();
    },
    [key, remote],
  );

  const ids = useMemo(() => new Set(query.data ?? NO_IDS), [query.data]);
  return { ids, status: query.status, toggle };
}
