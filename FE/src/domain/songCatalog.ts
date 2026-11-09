// 곡 목록·상세 타입 (설계 3-1). BE 응답 DTO를 1:1로 옮기되 숫자 id는 number, bpm은 number로 둔다.
import type { ChartSource, Difficulty } from './chart';

/** 곡 목록 범위. BE `source` 쿼리 값 */
export type SongScope = 'BUILTIN' | 'MINE';

export type NotationStatus = 'PENDING' | 'READY' | 'UNAVAILABLE' | string;

/** 반주 생성 상태(메일 CHART-002 MIDI 반주 합성 회신 3). 곡 `status`(채보 기준)와 따로 움직인다 */
export type AccompanimentStatus = 'GENERATING' | 'READY' | 'FAILED' | 'NONE';

const ACCOMPANIMENT_STATUSES: readonly AccompanimentStatus[] = ['GENERATING', 'READY', 'FAILED', 'NONE'];

/** 곡 난이도(메일 CHART-001 곡 난이도 산정 합의 회신 3). 곡 하나에 하나이고 연습 단계(Difficulty)와 다른 값이다 */
export type SongLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

/** 입문 → 고급. 필터 칩 순서 */
export const SONG_LEVEL_ORDER: readonly SongLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export const SONG_LEVEL_LABEL: Record<SongLevel, string> = { BEGINNER: '입문', INTERMEDIATE: '중급', ADVANCED: '고급' };

export interface SongSummary {
  id: number;
  title: string;
  artist: string;
  /** 곡 출처(응답값). 목록 범위(SongScope)와 다르다 */
  source: ChartSource;
  status: string;
  /** 채보 실패 코드. 서버 메시지는 보관하지 않는다 */
  chartFailure?: { code: string } | null;
  bpm: number;
  timeSignature: string;
  durationMs: number | null;
  hasAccompaniment: boolean;
  /** 반주 상태. 응답에 없으면 hasAccompaniment로 추정한 값 */
  accompanimentStatus: AccompanimentStatus;
  /** 곡 난이도. BE가 아직 계산하지 않았거나 모르는 값이면 null */
  songLevel: SongLevel | null;
  difficulties: Difficulty[];
  createdAt: string;
  /** 커버 이미지 서명 URL. 없으면 null(기본 커버) */
  coverUrl: string | null;
  /** 이 곡에 연결된 악보 id(설계 CHART-001 악보 보관 3-3). BE가 붙이기 전이거나 연결이 없으면 null */
  sheetId: number | null;
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
/** 연습 단계 배지 표기(설계 U17: 곡 난이도와 구분해 EASY·NORM·HARD로 쓴다) */
export const LEVEL_LABEL: Record<Difficulty, string> = { EASY: 'EASY', NORMAL: 'NORM', HARD: 'HARD' };

function rank(d: Difficulty): number {
  const i = DIFFICULTY_ORDER.indexOf(d);
  return i < 0 ? DIFFICULTY_ORDER.length : i;
}

/** 난이도 쉬움 → 어려움 순. 원본은 건드리지 않는다 */
export function sortCharts<T extends { difficulty: Difficulty }>(charts: readonly T[]): T[] {
  return [...charts].sort((a, b) => rank(a.difficulty) - rank(b.difficulty));
}

/** 기본 연습 단계: NORMAL, 없으면 쉬운 순서로 첫 채보. 채보가 없으면 null */
export function defaultChartId(detail: Pick<SongDetail, 'charts'>): number | null {
  const charts = sortCharts(detail.charts);
  return (charts.find((c) => c.difficulty === 'NORMAL') ?? charts[0])?.id ?? null;
}

/**
 * URL의 채보가 곡 응답 목록에 없을 때 바꿀 채보 id. 바꿀 필요가 없으면 null.
 * BE는 노트가 NORMAL과 같은 HARD·EASY를 곡 응답에서 빼므로(260번), 예전 링크로 들어온 숨긴 채보는 기본 단계로 옮긴다
 */
export function chartFallback(detail: Pick<SongDetail, 'charts'>, chartId: number): number | null {
  if (detail.charts.some((c) => c.id === chartId)) return null;
  return defaultChartId(detail);
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

function chartFailureFromDto(value: unknown): { code: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = (value as Record<string, unknown>).code;
  return typeof code === 'string' ? { code } : null;
}

/** 가수를 비워 올린 곡의 표시 문구. 저장은 빈 값 그대로 두고 화면에서만 바꾼다 */
export const UNKNOWN_ARTIST = '알 수 없음';

/** 화면에 보일 가수 이름. 비어 있으면(공백만 포함) 「알 수 없음」 */
export function artistLabel(artist: string | null | undefined): string {
  const name = artist?.trim() ?? '';
  return name === '' ? UNKNOWN_ARTIST : name;
}

export function songFromDto(d: Record<string, unknown>): SongSummary {
  return {
    id: toSafeId(d.id, 'songId'),
    title: String(d.title ?? ''),
    artist: String(d.artist ?? ''),
    source: d.source as ChartSource,
    status: String(d.status ?? ''),
    chartFailure: chartFailureFromDto(d.chartFailure),
    bpm: toNumber(d.bpm),
    timeSignature: String(d.timeSignature ?? '4/4'),
    durationMs: d.durationMs == null ? null : toNumber(d.durationMs),
    hasAccompaniment: d.hasAccompaniment === true,
    accompanimentStatus: accompanimentStatusOf(d),
    songLevel: songLevelOf(d.songLevel),
    difficulties: sortCharts(((d.difficulties as Difficulty[] | undefined) ?? []).map((difficulty) => ({ difficulty }))).map(
      (x) => x.difficulty,
    ),
    createdAt: String(d.createdAt ?? ''),
    coverUrl: typeof d.coverUrl === 'string' && d.coverUrl !== '' ? d.coverUrl : null,
    sheetId: d.sheetId == null ? null : toSafeId(d.sheetId, 'sheetId'),
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

/** 응답의 반주 상태. 4값이 아니거나 없으면(BE 병합 전·구버전) hasAccompaniment로 READY/NONE을 정한다 */
export function accompanimentStatusOf(d: Record<string, unknown>): AccompanimentStatus {
  const v = d.accompanimentStatus;
  if (typeof v === 'string' && (ACCOMPANIMENT_STATUSES as readonly string[]).includes(v)) return v as AccompanimentStatus;
  return d.hasAccompaniment === true ? 'READY' : 'NONE';
}

/** 응답의 곡 난이도. 세 값이 아니거나 없으면(BE 배포 전·미산정) null */
export function songLevelOf(v: unknown): SongLevel | null {
  return typeof v === 'string' && (SONG_LEVEL_ORDER as readonly string[]).includes(v) ? (v as SongLevel) : null;
}

/** 곡 난이도 표기. null이면 「—」 */
export function songLevelLabel(level: SongLevel | null): string {
  return level === null ? '—' : SONG_LEVEL_LABEL[level];
}

/** 내 곡 반주 배지. 채보가 READY인 곡의 생성 중·실패만 보이고, 나머지는 null(배지 없음) */
export function accompanimentView(songStatus: string, acc: AccompanimentStatus): SongStatusView | null {
  if (songStatus !== 'READY') return null;
  if (acc === 'GENERATING') return { label: '반주 생성 중', tone: 'active' };
  if (acc === 'FAILED') return { label: '반주 생성 실패', tone: 'danger' };
  return null;
}

/** 곡 옵션 「반주 재생」 괄호 문구. 반주가 있으면 빈 문자열. 상태를 모르면 「반주 없음」 */
export function accompanimentOptionText(acc: AccompanimentStatus | null | undefined): string {
  if (acc === 'READY') return '';
  if (acc === 'GENERATING') return '반주 생성 중';
  return '반주 없음';
}

/** 반주 폴링 대상: 채보는 READY인데 반주가 아직 생성 중인 곡 */
export function isAccompanimentPending(song: Pick<SongSummary, 'status' | 'accompanimentStatus'>): boolean {
  return song.status === 'READY' && song.accompanimentStatus === 'GENERATING';
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

/** 공개된 채보 실패 코드만 사용자 문구로 바꾼다 */
export function chartFailureText(failure: SongSummary['chartFailure']): string {
  switch (failure?.code) {
    case 'INPUT_INVALID':
      return '파일을 처리할 수 없어요';
    case 'OUTPUT_INVALID':
      return '채보 결과를 처리하지 못했어요';
    case 'MODEL_FAILED':
      return '채보 생성 중 오류가 발생했어요';
    case 'JOB_CANCELLED':
      return '채보 생성이 취소됐어요';
    case 'JOB_FAILED':
      return '채보 작업을 완료하지 못했어요';
    default:
      return '채보를 만들지 못했어요';
  }
}

/** 플레이·악보 연습에 쓸 수 있는 상태(설계 3-3). READY만 true */
export function isPlayableStatus(status: string): boolean {
  return status === 'READY';
}

/** 내 곡 정렬 그룹: 처리 중 0 → 실패 1 → 그 밖 2. 악보 항목도 「그 밖」에 속한다 */
export function mineGroup(status: string): number {
  if (status === 'PROCESSING') return 0;
  if (status === 'FAILED') return 1;
  return 2;
}

/** createdAt ISO → ms. 해석 못 하면 0 */
export function createdTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** 내 곡 정렬: 처리 중 → 실패 → 그 밖, 같은 그룹은 createdAt 내림차순. 원본은 건드리지 않는다 */
export function sortMineSongs(items: readonly SongSummary[]): SongSummary[] {
  return [...items].sort((a, b) => mineGroup(a.status) - mineGroup(b.status) || createdTime(b.createdAt) - createdTime(a.createdAt));
}

export interface MineSongSummary {
  total: number;
  ready: number;
  processing: number;
  failed: number;
}

/** 내 곡 상태별 개수. 모르는 상태는 total에만 센다 */
export function summarizeMineSongs(items: readonly SongSummary[]): MineSongSummary {
  const s: MineSongSummary = { total: items.length, ready: 0, processing: 0, failed: 0 };
  for (const it of items) {
    if (it.status === 'READY') s.ready += 1;
    else if (it.status === 'PROCESSING') s.processing += 1;
    else if (it.status === 'FAILED') s.failed += 1;
  }
  return s;
}
