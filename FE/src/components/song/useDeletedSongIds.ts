// 연주 로그의 BE 곡 중 삭제(404)로 확인된 곡 id 집합 (CHART-001 U7·U9). 곡마다 상세를 한 번씩 조회하고,
// 네트워크·5xx·401 같은 다른 실패는 "모름"으로 두어 표시하지 않는다. 언마운트·로그 변경 시 진행 중 요청을 중단한다.
import { useEffect, useState } from 'react';
import { checkSongAvailability } from '@/api/song/songs';
import { songIdsToCheck } from '@/domain/song/songAvailability';

const EMPTY: ReadonlySet<number> = new Set();

export function useDeletedSongIds(logs: readonly { songNumericId?: number | null }[]): ReadonlySet<number> {
  const [deleted, setDeleted] = useState<{ key: string; ids: ReadonlySet<number> }>({ key: '', ids: EMPTY });
  const ids = songIdsToCheck(logs);
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const list = key.split(',').map(Number);
    void Promise.all(list.map((id) => checkSongAvailability(id, ctrl.signal).then((a) => (a === 'deleted' ? id : null), () => null))).then(
      (found) => {
        if (!ctrl.signal.aborted) setDeleted({ key, ids: new Set(found.filter((id): id is number => id !== null)) });
      },
    );
    return () => ctrl.abort();
  }, [key]);
  // 다른 로그 묶음의 결과가 남아 있으면 쓰지 않는다
  return deleted.key === key ? deleted.ids : EMPTY;
}
