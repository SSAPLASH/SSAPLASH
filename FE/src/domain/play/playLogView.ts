// 연주 로그를 화면에 보여 줄 때 쓰는 순수 함수(결과·연주 기록 공용): 날짜·모드 표기, 모드 필터·검색, 날짜 묶음, 서버에 없는 기록 섞기.
import type { Difficulty } from '@/domain/song/chart';
import { songDifficulty } from '@/domain/play/recordingView';
import type { PlayLog } from './playLog';

/** ISO 시각 → `YYYY.MM.DD HH:mm`(브라우저 로컬 시간). 해석 못 하면 '-' */
export function formatPlayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 모드 표기(녹음 보관함과 같은 이름). 모르는 모드는 값 그대로 */
export function playModeName(mode: string): string {
  if (mode === 'RHYTHM') return '리듬 게임';
  if (mode === 'SHEET') return '악보 연습';
  if (mode === 'FREE') return '자유 연습';
  return mode;
}

export type HistoryFilter = 'ALL' | 'RHYTHM' | 'SHEET';

export function filterPlayLogs<T extends { mode: string }>(logs: readonly T[], filter: HistoryFilter): T[] {
  return filter === 'ALL' ? [...logs] : logs.filter((l) => l.mode === filter);
}

export type PlayLogSort = 'NEWEST' | 'OLDEST';

/** 곡 제목 검색: 앞뒤 공백을 지우고 대소문자 무시 부분 일치. 검색어가 비면 전체 사본 */
export function searchPlayLogs<T extends Pick<PlayLog, 'title'>>(logs: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...logs];
  return logs.filter((l) => l.title.toLowerCase().includes(needle));
}

/** 연주 기록 행의 난이도 배지(UX-53, 338 개편). 리듬 게임·악보 연습 행에 보이고, EASY·NORMAL·HARD가 아니면 생략한다 */
export function historyRowLevel(log: { mode: string; difficulty: string }): Difficulty | null {
  return log.mode === 'RHYTHM' || log.mode === 'SHEET' ? songDifficulty(log.difficulty) : null;
}

// ---- 연주 기록 화면 개편(338): 날짜 묶음 · 기간 · 서버에 없는 기록 · 정확도 단계 ----

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 로컬 날짜의 자정(ms) */
function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 날짜 묶음 제목: `오늘 · 11월 12일 (목)` · `어제 · …` · `11월 3일 (화)`. 해가 다르면 연도를 붙인다(브라우저 로컬 시간) */
export function playDayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const date = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  const days = Math.round((localMidnight(now) - localMidnight(d)) / DAY_MS);
  if (days === 0) return `오늘 · ${date}`;
  if (days === 1) return `어제 · ${date}`;
  return d.getFullYear() === now.getFullYear() ? date : `${d.getFullYear()}년 ${date}`;
}

/** 행 보조 줄의 시각: `오후 2:31`(브라우저 로컬 시간). 해석 못 하면 '-' */
export function formatPlayClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface DayGroup<T> {
  /** 로컬 날짜(`2026-11-12`). 못 읽는 시각은 '-' */
  key: string;
  label: string;
  items: T[];
}

/** 이미 정렬된 행을 순서를 지키며 같은 날끼리 묶는다 */
export function groupByDay<T>(rows: readonly T[], timeOf: (row: T) => string, now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const d = new Date(timeOf(row));
    const key = Number.isNaN(d.getTime()) ? '-' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(row);
    else groups.push({ key, label: playDayLabel(timeOf(row), now), items: [row] });
  }
  return groups;
}

export type HistoryPeriod = 'ALL' | '7D' | '30D';

/** 서버 `from`·`to`(종료일, 한국 시간, 양 끝 포함). 전체 기간이면 둘 다 없다 */
export interface PeriodRange {
  from?: string;
  to?: string;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 그 순간의 한국 시간 날짜(`YYYY-MM-DD`). 브라우저 시간대와 무관하다 */
function kstDate(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 기간 단추 → 서버 날짜 범위. 7일·30일은 오늘을 포함해 센다 */
export function periodRange(period: HistoryPeriod, now: Date): PeriodRange {
  if (period === 'ALL') return {};
  const days = period === '7D' ? 7 : 30;
  return { from: kstDate(now.getTime() - (days - 1) * DAY_MS), to: kstDate(now.getTime()) };
}

/** 서버에 없는 기록에 같은 기간 조건을 적용한다(한국 시간 날짜, 양 끝 포함). 전체 기간이면 날짜를 못 읽는 로그도 거르지 않는다 */
export function inPeriod(iso: string, range: PeriodRange): boolean {
  if (range.from === undefined && range.to === undefined) return true;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const day = kstDate(ms);
  return (range.from === undefined || day >= range.from) && (range.to === undefined || day <= range.to);
}

/** 아직 서버에 없는 기록의 저장 상태. SAVING 올리는 중 · FAILED 다시 보낼 수 있는 실패 · UNSAVED 보낼 수 없음(옛 로그 포함) */
export type SaveStatus = 'SAVING' | 'FAILED' | 'UNSAVED';

/** 업로드 상태 → 저장 상태. 저장이 끝났으면(DONE) null */
export function saveStatusOf(upload: PlayLog['upload']): SaveStatus | null {
  if (!upload) return 'UNSAVED';
  if (upload.status === 'DONE') return null;
  if (upload.status === 'UPLOADING') return 'SAVING';
  return upload.status === 'FAILED' && upload.retryable ? 'FAILED' : 'UNSAVED';
}

/**
 * 이 브라우저의 로그 중 서버 목록과 섞어 보일 것: 받은 서버 쪽에 없고 저장이 끝나지 않은 로그.
 * 저장이 끝난(DONE) 로그는 서버에 있으므로, 아직 받지 않은 쪽에 있더라도 섞지 않는다(쪽 단위 조회라 목록만으로는 구분할 수 없다).
 * `live`는 이번 접속에서 바뀐 상태(usePlaySync)로, 로그에 저장된 값보다 먼저다.
 */
export function unsavedLogs<T extends Pick<PlayLog, 'playId' | 'upload'>>(
  logs: readonly T[],
  serverIds: ReadonlySet<string>,
  live: Readonly<Record<string, PlayLog['upload']>>,
): T[] {
  return logs.filter((l) => !serverIds.has(l.playId) && (live[l.playId] ?? l.upload)?.status !== 'DONE');
}

export interface MergeUnsavedOptions<S, L> {
  sort: PlayLogSort;
  /** 서버에 다음 쪽이 남았는가 */
  hasNext: boolean;
  serverTime: (row: S) => string;
  localTime: (row: L) => string;
}

const timeMs = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * 받은 서버 행(이미 정렬됨)에 서버에 없는 기록을 시각 순서로 섞는다.
 * 다음 쪽이 남았으면 받은 범위 안(마지막 서버 행까지)의 것만 섞는다 — 범위 밖의 것은 그 쪽을 받을 때 제자리에 나온다.
 * 같은 시각이면 서버 행이 먼저다.
 */
export function mergeUnsaved<S, L>(server: readonly S[], local: readonly L[], o: MergeUnsavedOptions<S, L>): (S | L)[] {
  const sign = o.sort === 'NEWEST' ? -1 : 1;
  const last = server[server.length - 1];
  const edge = o.hasNext && last !== undefined ? timeMs(o.serverTime(last)) : null;
  const kept = edge === null ? [...local] : local.filter((l) => (timeMs(o.localTime(l)) - edge) * sign <= 0);
  const rows: { row: S | L; t: number }[] = [
    ...server.map((row) => ({ row, t: timeMs(o.serverTime(row)) })),
    ...kept.map((row) => ({ row, t: timeMs(o.localTime(row)) })),
  ];
  // Array.prototype.sort는 안정 정렬이라 같은 시각이면 앞에 둔 서버 행이 먼저 남는다
  return rows.sort((a, b) => (a.t - b.t) * sign).map((r) => r.row);
}

/** 정확도 막대 단계. 판정 색과 같은 뜻으로 쓴다(90 이상 PERFECT 하늘색 · 70 이상 GOOD 초록 · 그 아래 MISS 빨강, 70은 입문 코스 통과 기준) */
export type AccuracyTier = 'PERFECT' | 'GOOD' | 'MISS';

export function accuracyTier(percent: number): AccuracyTier {
  return percent >= 90 ? 'PERFECT' : percent >= 70 ? 'GOOD' : 'MISS';
}

export interface HistoryRowLink {
  kind: 'REPORT' | 'RESULT';
  to: string;
}

/** 행 오른쪽 링크. 리포트가 있으면 리포트, 없고 이 브라우저에 로그가 있으면 결과 화면, 둘 다 없으면 없음 */
export function historyRowLink(row: { playId: string; hasReport: boolean; hasLocal: boolean }): HistoryRowLink | null {
  if (row.hasReport) return { kind: 'REPORT', to: `/result/${row.playId}/report` };
  if (row.hasLocal) return { kind: 'RESULT', to: `/result/${row.playId}` };
  return null;
}
