// 결과 화면 [다시 하기] 경로 계산(D8). 로그·업로드는 건드리지 않고 경로만 복구한다.
import { BUILTIN_CHARTS, builtinId } from './chart';

/** 경로 계산에 쓰는 로그 필드(PlayLog의 부분) */
export interface RetryLog {
  mode: string;
  songNumericId?: number | null;
  chartId?: number | null;
  songId: string;
}

/** 모드별 선택 화면 경로 */
export const pickPathOf = (mode: string): string => (mode === 'SHEET' ? '/sheet' : '/play');

/**
 * 같은 곡 준비 화면 경로. BE 곡이면 로그의 id로, 내장 소스이고 songId가 내장 채보와 맞으면 음수 id로 복원한다.
 * 어느 쪽도 아니면(이전 로그·api 소스 + id 없음) 모드별 선택 화면으로 간다.
 */
export function retryPathOf(log: RetryLog, opts: { songsSource: 'api' | 'builtin' }): string {
  const pick = pickPathOf(log.mode);
  if (log.songNumericId != null && log.chartId != null) {
    return `${pick}?song=${log.songNumericId}&chart=${log.chartId}`;
  }
  if (opts.songsSource === 'builtin') {
    const i = BUILTIN_CHARTS.findIndex((c) => c.songId === log.songId);
    if (i >= 0) return `${pick}?song=${builtinId(i)}&chart=${builtinId(i)}`;
  }
  return pick;
}
