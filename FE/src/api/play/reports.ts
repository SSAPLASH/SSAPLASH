// 플레이 리포트 조회 (COACH-002, BE 157·158). 서버 응답 → 화면 타입 변환을 여기 한 곳에서 한다(설계 D6).
// - 정확도: 서버 0~100 → 화면 0~1. null은 그대로 두고 화면에서 "–"
// - 패드 코드: normalizePadId(옛 이름 HI_TOM → SMALL_TOM). 모르는 패드는 버린다
// - 노트 시각: PERFECT·GOOD은 tMs − deltaMs × playbackRate, MISS는 tMs(tMs는 곡 시각, deltaMs는 실제 시간 — 연습 속도로 친 기록은
//   배율을 곱해 곡 시각으로 맞춘다. BE·AI와 같은 식). seq는 시간순이 아니므로 모두 받은 뒤 정렬한다
import type { Difficulty } from '@/domain/song/chart';
import { slowRateOf } from '@/domain/song/practiceRate';
import type { Judgement } from '@/domain/play/judgement';
import { normalizePadId, type PadId } from '@/domain/kit/pads';
import type { AnalysisStatus, CoachSummary, Report, ReportNote, SeverityLevel, WeakScope, WeakSegment } from '@/domain/play/report';
import { apiFetch } from '@/api/http';

type Num = number | string;

interface CountsDto {
  perfect: number;
  good: number;
  miss: number;
}

export interface ReportDto {
  id: number;
  playId: string;
  score: number;
  accuracy: Num;
  maxCombo: number;
  judgementCounts: CountsDto;
  timingHistogram: { binMs: number; fromMs: number; counts: number[] } | null;
  padStats: {
    pad: string;
    accuracy: Num | null;
    meanDeltaMs: Num | null;
    meanVelocity: Num | null;
    judgementCounts: CountsDto;
    sampleCount: number;
  }[];
  mode: string;
  /** 선택 필드 — BE가 곡 정보를 추가하기 전 응답에는 없다 */
  songId?: unknown;
  chartId?: unknown;
  difficulty?: unknown;
  inputSource: string;
  endReason: string | null;
  /** 연주 배율(연습 속도). 없던 옛 기록은 1. 이 필드가 생기기 전 서버 응답에는 없다 */
  playbackRate?: unknown;
  analysisStatus: AnalysisStatus;
  weakSegments: unknown;
  coachSummary?: unknown;
  recommendedDrills: unknown;
  generatorVersion: string;
  generatedAt: string;
}

export interface ReportNoteDto {
  seq: number;
  matchedNoteId: string | null;
  tMs: number;
  pad: string;
  judgement: Judgement;
  deltaMs: number | null;
  velocity: number | null;
}

export interface ReportNotesDto {
  items: ReportNoteDto[];
  nextAfterSeq: number | null;
}

const num = (v: Num): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: Num | null): number | null => (v === null ? null : num(v));
const counts = (c: CountsDto): Record<Judgement, number> => ({ PERFECT: c.perfect, GOOD: c.good, MISS: c.miss });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 숫자 또는 숫자 문자열 → 유한수, 아니면 null */
function finite(v: unknown): number | null {
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const isSeverityLevel = (v: unknown): v is SeverityLevel => v === 'LOW' || v === 'MEDIUM' || v === 'HIGH';

/** 총평 응답 변환. 객체이고 text가 비어 있지 않은 문자열일 때만, 아니면 null. level·source는 문자열 그대로 보관 */
export function toCoachSummary(raw: unknown): CoachSummary | null {
  if (!isObj(raw) || typeof raw.text !== 'string' || raw.text === '') return null;
  return {
    level: typeof raw.level === 'string' ? raw.level : '',
    text: raw.text,
    focusPattern: typeof raw.focusPattern === 'string' ? raw.focusPattern : null,
    source: typeof raw.source === 'string' ? raw.source : null,
  };
}

/** 약점 구간 응답 변환(설계 3-1). 배열이 아니면 null, 깨진 요소만 버리고 서버 순서는 유지한다 */
export function toWeakSegments(raw: unknown): WeakSegment[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((el: unknown): WeakSegment[] => {
    if (!isObj(el)) return [];
    const fromMs = finite(el.fromMs);
    const toMs = finite(el.toMs);
    if (typeof el.description !== 'string' || el.description === '' || fromMs === null || toMs === null) return [];
    const { severity, scope, ...rest } = isObj(el.metrics) ? el.metrics : ({} as Record<string, unknown>);
    const sev = finite(severity);
    const pads = Array.isArray(el.pads)
      ? el.pads.flatMap((p: unknown): PadId[] => {
          const id = typeof p === 'string' ? normalizePadId(p) : null;
          return id ? [id] : [];
        })
      : [];
    return [
      {
        fromMs,
        toMs,
        pattern: typeof el.pattern === 'string' ? el.pattern : '',
        description: el.description,
        ...(typeof el.tip === 'string' && el.tip !== '' ? { tip: el.tip } : {}),
        ...(typeof el.detail === 'string' && el.detail !== '' ? { detail: el.detail } : {}),
        ...(isSeverityLevel(el.severityLevel) ? { severityLevel: el.severityLevel } : {}),
        causeTags: Array.isArray(el.causeTags) ? el.causeTags.filter((t): t is string => typeof t === 'string') : [],
        pads,
        severity: sev === null ? 0 : Math.min(1, Math.max(0, sev)),
        scope: (scope === 'WHOLE' || scope === 'SEGMENT' ? scope : 'SEGMENT') as WeakScope,
        metrics: rest,
      },
    ];
  });
}

/** 양의 정수 id만 인정한다(없거나 모르는 값은 null) */
function positiveId(v: unknown): number | null {
  const n = finite(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

const isDifficulty = (v: unknown): v is Difficulty => v === 'EASY' || v === 'NORMAL' || v === 'HARD';

export function toReport(dto: ReportDto): Report {
  return {
    playId: dto.playId,
    score: dto.score,
    accuracy: num(dto.accuracy) / 100,
    maxCombo: dto.maxCombo,
    counts: counts(dto.judgementCounts),
    histogram: dto.timingHistogram,
    padStats: dto.padStats.flatMap((p) => {
      const pad = normalizePadId(p.pad);
      if (!pad) return [];
      const acc = numOrNull(p.accuracy);
      return [
        {
          pad,
          accuracy: acc === null ? null : acc / 100,
          meanDeltaMs: numOrNull(p.meanDeltaMs),
          meanVelocity: numOrNull(p.meanVelocity),
          counts: counts(p.judgementCounts),
          sampleCount: p.sampleCount,
        },
      ];
    }),
    mode: dto.mode,
    songId: positiveId(dto.songId),
    chartId: positiveId(dto.chartId),
    difficulty: isDifficulty(dto.difficulty) ? dto.difficulty : null,
    inputSource: dto.inputSource,
    playbackRate: slowRateOf(dto.playbackRate) ?? 1,
    analysisStatus: dto.analysisStatus,
    weakSegments: toWeakSegments(dto.weakSegments),
    coachSummary: toCoachSummary(dto.coachSummary),
    recommendedDrills: dto.recommendedDrills,
    generatedAt: dto.generatedAt,
  };
}

/** rate는 리포트 본문의 연습 배율(playbackRate). 원래 빠르기는 1이고, 유한한 양수가 아니면 1로 본다 */
export function toReportNote(dto: ReportNoteDto, rate = 1): ReportNote | null {
  const pad = normalizePadId(dto.pad);
  if (!pad) return null;
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const timeMs = dto.judgement !== 'MISS' && dto.deltaMs !== null ? dto.tMs - dto.deltaMs * r : dto.tMs;
  return { seq: dto.seq, noteId: dto.matchedNoteId, timeMs, pad, judgement: dto.judgement, deltaMs: dto.deltaMs, velocity: dto.velocity };
}

const base = (playId: string) => `/api/v1/plays/${encodeURIComponent(playId)}/report`;

/** `GET /api/v1/plays/{playId}/report` */
export async function getReport(playId: string, signal?: AbortSignal): Promise<Report> {
  return toReport(await apiFetch<ReportDto>(base(playId), { signal }));
}

/** 노트 페이지 하나. limit 최대 1,000 */
export function getReportNotesPage(playId: string, afterSeq: number | null, limit = 1000, signal?: AbortSignal): Promise<ReportNotesDto> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (afterSeq !== null) q.set('afterSeq', String(afterSeq));
  return apiFetch<ReportNotesDto>(`${base(playId)}/notes?${q}`, { signal });
}

/** 노트 전부를 nextAfterSeq가 null이 될 때까지 받아 시간순으로. first가 있으면 첫 페이지 요청을 건너뛴다(미리 받기). rate는 연습 배율(없으면 1) */
export async function getAllReportNotes(playId: string, opts: { first?: ReportNotesDto; signal?: AbortSignal; rate?: number } = {}): Promise<ReportNote[]> {
  const out: ReportNote[] = [];
  let page = opts.first ?? (await getReportNotesPage(playId, null, 1000, opts.signal));
  for (;;) {
    for (const d of page.items) {
      const n = toReportNote(d, opts.rate);
      if (n) out.push(n);
    }
    if (page.nextAfterSeq === null) break;
    page = await getReportNotesPage(playId, page.nextAfterSeq, 1000, opts.signal);
  }
  return out.sort((a, b) => a.timeMs - b.timeMs || a.seq - b.seq);
}
