// 연주 로그를 화면에 보여 줄 때 쓰는 순수 함수(결과·연주 기록 공용): 날짜·모드 표기, 모드 필터, 페이지 계산.
import type { PlayLog } from '@/engine/playLog';

/** ISO 시각 → `YYYY.MM.DD HH:mm`(브라우저 로컬 시간). 해석 못 하면 '-' */
export function formatPlayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 모드 표기. 리듬 = 게임, 악보 = 악보, 그 밖은 모드 값 그대로 */
export function playModeName(mode: string): string {
  if (mode === 'RHYTHM') return '게임';
  if (mode === 'SHEET') return '악보';
  return mode;
}

export type HistoryFilter = 'ALL' | 'RHYTHM' | 'SHEET';

export function filterPlayLogs<T extends Pick<PlayLog, 'mode'>>(logs: readonly T[], filter: HistoryFilter): T[] {
  return filter === 'ALL' ? [...logs] : logs.filter((l) => l.mode === filter);
}

export const HISTORY_PAGE_SIZE = 10;

export interface PageInfo {
  page: number;
  pageCount: number;
  /** 보이는 행 범위(1부터, 양쪽 포함). 0건이면 0 */
  from: number;
  to: number;
}

/** 요청 페이지를 범위 안으로 맞추고 보이는 행 범위를 계산한다(page는 0부터) */
export function pageInfo(total: number, page: number, size = HISTORY_PAGE_SIZE): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, page), pageCount - 1);
  return { page: p, pageCount, from: total ? p * size + 1 : 0, to: Math.min(total, (p + 1) * size) };
}
