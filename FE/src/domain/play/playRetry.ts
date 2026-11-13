// 결과 화면 [다시 하기] 경로 계산(D8). 로그·업로드는 건드리지 않고 경로만 복구한다.
import { BUILTIN_CHARTS, builtinId } from '@/domain/song/chart';

/** 경로 계산에 쓰는 로그 필드(PlayLog의 부분) */
export interface RetryLog {
  mode: string;
  songNumericId?: number | null;
  chartId?: number | null;
  songId: string;
}

/** 모드별 선택 화면 경로 */
export const pickPathOf = (mode: string): string => (mode === 'SHEET' ? '/sheet' : '/play');

/** 리듬 게임 [다시 하기]가 navigate state로 싣는 값. PlayPage가 이것을 보고 곡 선택을 거치지 않고 바로 카운트다운으로 들어간다(주소에는 싣지 않아 새로고침·공유 링크로는 자동 시작하지 않는다) */
export const RETRY_AUTOSTART_STATE = { autoStart: true } as const;

/** 악보 연습(/sheet)이면 곡 선택에서 그 곡·단계를 골라 둔 채 시작 확인 창을 연다(`start=1`). 리듬 게임은 주소에 `start`를 쓰지 않는다 — 추천 등 링크는 곡·단계만 골라 두고, 다시 하기만 RETRY_AUTOSTART_STATE로 바로 시작한다 */
const withStart = (mode: string, path: string): string => (mode === 'SHEET' ? `${path}&start=1` : path);

/**
 * 같은 곡 다시 하기 경로(악보 연습은 시작 확인 창이 열린 곡 선택, 리듬 게임은 그 곡·단계의 주소 — RETRY_AUTOSTART_STATE와 함께 가면 바로 시작). BE 곡이면 로그의 id로, 내장 소스이고 songId가 내장 채보와 맞으면 음수 id로 복원한다.
 * 어느 쪽도 아니면(이전 로그·api 소스 + id 없음) 모드별 선택 화면으로 간다.
 */
export function retryPathOf(log: RetryLog, opts: { songsSource: 'api' | 'builtin' }): string {
  const pick = pickPathOf(log.mode);
  if (log.songNumericId != null && log.chartId != null) {
    return withStart(log.mode, `${pick}?song=${log.songNumericId}&chart=${log.chartId}`);
  }
  if (opts.songsSource === 'builtin') {
    const i = BUILTIN_CHARTS.findIndex((c) => c.songId === log.songId);
    if (i >= 0) return withStart(log.mode, `${pick}?song=${builtinId(i)}&chart=${builtinId(i)}`);
  }
  return pick;
}
