import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBestRecords, type BestRecordDto } from '@/api/play/plays';
import { selectServerBestRecords, type BestRecordMode } from '@/features/play/api/serverBestRecord';
import { useAuth } from '@/store/authStore';
import type { SongsSource } from '@/store/songStore';
import { usePlaySync } from '@/runtime/playSync';

export type BestRecordsStatus = 'idle' | 'loading' | 'ready' | 'error';
interface Snapshot { key: string; items: BestRecordDto[] | null }

export function useBestRecords(songIds: readonly number[], mode: BestRecordMode, enabled: boolean, source: SongsSource) {
  const authStatus = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  const completed = usePlaySync((s) => Object.entries(s.states)
    .filter(([, state]) => state.status === 'DONE')
    .map(([id, state]) => `${id}:${state.updatedAt}`).sort().join('|'));
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const idsKey = [...new Set(songIds.filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b).join(',');
  const ids = useMemo(() => idsKey ? idsKey.split(',').map(Number) : [], [idsKey]);
  const key = JSON.stringify([authStatus, userId, source, idsKey, mode, attempt, completed]);
  // 계정·곡 집합이 바뀐 렌더부터 이전 스냅샷을 폐기한다(이전 계정으로 돌아와도 재조회).
  if (snapshot !== null && snapshot.key !== key) setSnapshot(null);
  const active = enabled && source === 'api' && authStatus === 'authenticated' && userId !== null && ids.length > 0;
  const current = snapshot?.key === key ? snapshot : null;
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    // 같은 곡의 단계 전환 중 채보 로딩으로 잠깐 비활성화되어도 성공한 곡별 결과는 재사용한다.
    // 곡 선택으로 나가면 ID가 비어 스냅샷을 지우며, 계정·업로드 완료 변화도 재사용하지 않는다.
    if (!active) return;
    if (snapshot?.key === key) return;
    const controller = new AbortController();
    void (async () => {
      const items: BestRecordDto[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const response = await getBestRecords(ids.slice(offset, offset + 100), controller.signal);
        if (controller.signal.aborted) return;
        items.push(...response.items);
      }
      if (!controller.signal.aborted) setSnapshot({ key, items });
    })().catch(() => {
      if (!controller.signal.aborted) setSnapshot({ key, items: null });
    });
    return () => controller.abort();
  }, [active, key, ids, enabled, source, authStatus, snapshot]);

  const status: BestRecordsStatus = !active ? 'idle' : !current ? 'loading' : current.items === null ? 'error' : 'ready';
  const records = useMemo(() => selectServerBestRecords(active ? current?.items ?? [] : [], ids, mode), [active, current, ids, mode]);
  return { status, ...records, retry };
}
