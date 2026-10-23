// URL 쿼리(`?song=&chart=`)로 곡 선택을 읽고 채보를 불러오는 훅 (설계 D12). /play·/sheet가 같이 쓴다.
// 쿼리가 없으면 status 'none'(곡 선택 단계), 있으면 loadChart → 'ready' | 'error'.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadChart, type LoadedChart } from '@/store/songStore';

export type ChartParamStatus = 'none' | 'loading' | 'ready' | 'error';

function parseId(raw: string | null): number | null {
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

interface Fetched {
  key: string;
  loaded: LoadedChart | null;
  error: string | null;
}

export function useChartParam() {
  const [params, setParams] = useSearchParams();
  const songId = parseId(params.get('song'));
  const chartId = parseId(params.get('chart'));
  const key = songId !== null && chartId !== null ? `${songId}:${chartId}` : null;
  const [fetched, setFetched] = useState<Fetched | null>(null);

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
  }, [key, songId, chartId]);

  // 현재 URL 키와 같은 결과만 인정한다(이전 곡 결과가 잠깐 보이는 것을 막는다)
  const current = fetched && fetched.key === key ? fetched : null;
  const status: ChartParamStatus = key === null ? 'none' : current === null ? 'loading' : current.error ? 'error' : 'ready';

  /** 곡·난이도를 URL에 싣는다 */
  const select = useCallback(
    (song: number, chart: number) => {
      setFetched(null); // 같은 곡을 다시 골라도(오류 재시도 포함) 새로 읽는다
      setParams({ song: String(song), chart: String(chart) });
    },
    [setParams],
  );
  /** 곡 선택 단계로: 쿼리를 지운다 */
  const clear = useCallback(() => {
    setFetched(null);
    setParams({}, { replace: true });
  }, [setParams]);

  return { status, loaded: current?.loaded ?? null, error: current?.error ?? null, select, clear };
}
