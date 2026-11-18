// URL 쿼리(`?song=&chart=`)로 곡 선택을 읽고 채보를 불러오는 훅 (설계 D12). /play·/sheet가 같이 쓴다.
// 쿼리가 없으면 status 'none'(곡 선택 단계), 있으면 loadChart → 'ready' | 'error'.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseId } from '@/features/play/domain/playShared';
import { loadChart, type LoadedChart } from '@/store/songStore';

export type ChartParamStatus = 'none' | 'loading' | 'ready' | 'error';

interface Fetched {
  key: string;
  loaded: LoadedChart | null;
  error: string | null;
}

/** 곡 선택 범위 쿼리만 남긴다(Jira 331: `?tab=lessons`와 고른 코스 `course`, 악보 연습 내 곡 `?scope=MINE`) */
function keptTab(prev: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  const tab = prev.get('tab');
  if (tab) out.tab = tab;
  const course = prev.get('course');
  if (tab === 'lessons' && course) out.course = course;
  const scope = prev.get('scope');
  if (scope === 'MINE') out.scope = scope;
  return out;
}

/**
 * `enabled`가 false면 쿼리가 있어도 채보를 읽지 않고 status 'none'이다(악보 연습: 곡·단계는 주소로 골라 두기만 하고
 * 시작 확인 창이 열릴 때 비로소 읽는다). 기본 true.
 */
export function useChartParam({ enabled = true }: { enabled?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const songId = parseId(params.get('song'));
  const chartId = parseId(params.get('chart'));
  const key = enabled && songId !== null && chartId !== null ? `${songId}:${chartId}` : null;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  // 같은 곡·단계를 다시 읽는 횟수(오류 재시도). 주소가 그대로여도 읽기 effect를 다시 돌린다
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (songId === null || chartId === null || key === null) return;
    const ctrl = new AbortController();
    loadChart({ songId, chartId }, ctrl.signal).then(
      (loaded) => {
        if (!ctrl.signal.aborted) setFetched({ key, loaded, error: null });
      },
      (e: unknown) => {
        if (!ctrl.signal.aborted) {
          setFetched({ key, loaded: null, error: e instanceof Error ? e.message : '채보를 불러오지 못했습니다.' });
        }
      },
    );
    return () => ctrl.abort();
  }, [key, songId, chartId, attempt]);

  // 현재 URL 키와 같은 결과만 인정한다(이전 곡 결과가 잠깐 보이는 것을 막는다)
  const current = fetched && fetched.key === key ? fetched : null;
  const status: ChartParamStatus = key === null ? 'none' : current === null ? 'loading' : current.error ? 'error' : 'ready';

  /**
   * 곡·난이도를 URL에 싣는다. replace면 방문 기록을 쌓지 않는다(숨긴 채보 보정처럼 사용자가 고르지 않은 변경). 곡 선택 탭(`tab`)은 남긴다.
   * start면 `start=1`도 싣는다(악보 연습: 시작 확인 창을 연다)
   */
  const select = useCallback(
    (song: number, chart: number, options?: { replace?: boolean; start?: boolean }) => {
      setFetched(null); // 같은 곡을 다시 골라도(오류 재시도 포함) 새로 읽는다
      setParams(
        (prev) => ({ ...keptTab(prev), song: String(song), chart: String(chart), ...(options?.start ? { start: '1' } : {}) }),
        options?.replace ? { replace: true } : undefined,
      );
    },
    [setParams],
  );
  /** 주소는 그대로 두고 지금 곡·단계의 채보를 다시 읽는다(오류 [다시 시도]) */
  const reload = useCallback(() => {
    setFetched(null);
    setAttempt((n) => n + 1);
  }, []);
  /** 곡 선택 단계로: 쿼리를 지운다. 곡 선택 범위(`tab`, 학습 코스와 고른 코스)는 남겨 같은 자리로 돌아간다 */
  const clear = useCallback(() => {
    setFetched(null);
    setParams((prev) => keptTab(prev), { replace: true });
  }, [setParams]);

  return { status, loaded: current?.loaded ?? null, error: current?.error ?? null, select, clear, reload };
}
