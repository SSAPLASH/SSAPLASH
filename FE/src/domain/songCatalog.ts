// 곡 목록·상세 타입 (설계 3-1). BE 응답 DTO를 1:1로 옮기되 숫자 id는 number, bpm은 number로 둔다.
import type { ChartSource, Difficulty } from './chart';

/** 곡 목록 범위. BE `source` 쿼리 값 */
export type SongScope = 'BUILTIN' | 'MINE';

export type NotationStatus = 'PENDING' | 'READY' | 'UNAVAILABLE' | string;

export interface SongSummary {
  id: number;
  title: string;
  artist: string;
  /** 곡 출처(응답값). 목록 범위(SongScope)와 다르다 */
  source: ChartSource;
  status: string;
  bpm: number;
  timeSignature: string;
  durationMs: number | null;
  hasAccompaniment: boolean;
  difficulties: Difficulty[];
  createdAt: string;
}

export interface ChartSummary {
  id: number;
  difficulty: Difficulty;
  /** 내장 소스는 null */
  chartVersionId: number | null;
  version: number;
  noteCount: number;
  notationStatus: NotationStatus;
}

export interface SongDetail extends SongSummary {
  license: string | null;
  updatedAt: string | null;
  charts: ChartSummary[];
}

/** 곡 목록 한 쪽 */
export interface SongPage {
  items: SongSummary[];
  hasNext: boolean;
}

export const DIFFICULTY_ORDER: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

function rank(d: Difficulty): number {
  const i = DIFFICULTY_ORDER.indexOf(d);
  return i < 0 ? DIFFICULTY_ORDER.length : i;
}

/** 난이도 쉬움 → 어려움 순. 원본은 건드리지 않는다 */
export function sortCharts<T extends { difficulty: Difficulty }>(charts: readonly T[]): T[] {
  return [...charts].sort((a, b) => rank(a.difficulty) - rank(b.difficulty));
}

/** 응답 id는 JSON 숫자다. 안전한 정수가 아니면 거부한다(BE README FE 소비 계약) */
export function toSafeId(v: unknown, what = 'id'): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`${what}가 올바른 정수가 아닙니다: ${String(v)}`);
  return n;
}

/** BigDecimal은 숫자 또는 문자열로 올 수 있다 */
function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function songFromDto(d: Record<string, unknown>): SongSummary {
  return {
    id: toSafeId(d.id, 'songId'),
    title: String(d.title ?? ''),
    artist: String(d.artist ?? ''),
    source: d.source as ChartSource,
    status: String(d.status ?? ''),
    bpm: toNumber(d.bpm),
    timeSignature: String(d.timeSignature ?? '4/4'),
    durationMs: d.durationMs == null ? null : toNumber(d.durationMs),
    hasAccompaniment: d.hasAccompaniment === true,
    difficulties: sortCharts(((d.difficulties as Difficulty[] | undefined) ?? []).map((difficulty) => ({ difficulty }))).map(
      (x) => x.difficulty,
    ),
    createdAt: String(d.createdAt ?? ''),
  };
}

export function songDetailFromDto(d: Record<string, unknown>): SongDetail {
  const charts = ((d.charts as Record<string, unknown>[] | undefined) ?? []).map(
    (c): ChartSummary => ({
      id: toSafeId(c.id, 'chartId'),
      difficulty: c.difficulty as Difficulty,
      chartVersionId: c.chartVersionId == null ? null : toSafeId(c.chartVersionId, 'chartVersionId'),
      version: toNumber(c.version),
      noteCount: toNumber(c.noteCount),
      notationStatus: String(c.notationStatus ?? ''),
    }),
  );
  return {
    ...songFromDto(d),
    license: d.license == null ? null : String(d.license),
    updatedAt: d.updatedAt == null ? null : String(d.updatedAt),
    charts: sortCharts(charts),
  };
}

/** 곡 처리 상태 표기(설계 ACCT-001 마이페이지 3-2). tone은 배지 색, 모르는 값은 원문 그대로 */
export interface SongStatusView {
  label: string;
  tone: 'default' | 'active' | 'danger';
}

export function songStatusView(status: string): SongStatusView {
  switch (status) {
    case 'READY':
      return { label: '완료', tone: 'default' };
    case 'PROCESSING':
      return { label: '채보 생성 중', tone: 'active' };
    case 'FAILED':
      return { label: '생성 실패', tone: 'danger' };
    default:
      return { label: status, tone: 'default' };
  }
}
