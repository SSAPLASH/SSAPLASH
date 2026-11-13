// 내 곡 화면에서 반주 생성 중 곡을 짧게 다시 읽어 목록 배지를 갱신한다 (설계 CHART-002 반주 상태 4-2).
// 탭이 숨겨지면 멈췄다가 보이면 남은 횟수로 이어가고, 화면을 떠나면 멈춘다. 다시 들어오면 새 인스턴스라 횟수를 0부터 센다.
import { useCallback, useEffect, useState } from 'react';
import { getSong } from '@/api/song/songs';
import { isAccompanimentPending, type SongSummary } from '@/domain/song/songCatalog';
import { patchSongStatus, songKeys } from '@/api/song/songQueries';
import { queryClient } from '@/runtime/queryClient';
import { AccompanimentPoller } from './accompanimentPoller';

/** 다시 읽은 곡 상태를 캐시된 모든 곡 목록(라이브러리·곡 선택)에 반영한다 (설계 TECH-351) */
export function patchCachedSong(song: SongSummary): void {
  queryClient.setQueriesData<SongSummary[]>({ queryKey: songKeys.lists() }, (old) => (old ? patchSongStatus(old, song) : old));
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useAccompanimentPolling(items: readonly SongSummary[], enabled: boolean): (id: number) => void {
  const [poller] = useState(
    () => new AccompanimentPoller({ fetchSong: (id, signal) => getSong(id, signal), onSong: patchCachedSong }),
  );
  const [visible, setVisible] = useState(isVisible);

  useEffect(() => {
    const onVisibility = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const key = items
    .filter(isAccompanimentPending)
    .map((s) => s.id)
    .join(',');

  useEffect(() => {
    poller.update(key ? key.split(',').map(Number) : [], enabled && visible);
  }, [poller, key, enabled, visible]);

  useEffect(() => () => poller.dispose(), [poller]);
  return useCallback((id: number) => poller.restart(id), [poller]);
}
