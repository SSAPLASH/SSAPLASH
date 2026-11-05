// 내 곡 화면에서 반주 생성 중 곡을 짧게 다시 읽어 목록 배지를 갱신한다 (설계 CHART-002 반주 상태 4-2).
// 탭이 숨겨지면 멈췄다가 보이면 남은 횟수로 이어가고, 화면을 떠나면 멈춘다. 다시 들어오면 새 인스턴스라 횟수를 0부터 센다.
import { useEffect, useState } from 'react';
import { getSong } from '@/api/songs';
import { isAccompanimentPending, type SongSummary } from '@/domain/songCatalog';
import { useSongs } from '@/store/songStore';
import { AccompanimentPoller } from './accompanimentPoller';

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useAccompanimentPolling(items: readonly SongSummary[], enabled: boolean): void {
  const [poller] = useState(
    () => new AccompanimentPoller({ fetchSong: (id, signal) => getSong(id, signal), onSong: (song) => useSongs.getState().patchItem(song) }),
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
}
