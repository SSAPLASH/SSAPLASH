// 플레이 리포트 조회 (COACH-002, BE 157·158). 서버 응답 → 화면 타입 변환을 여기 한 곳에서 한다(설계 D6).
// - 정확도: 서버 0~100 → 화면 0~1. null은 그대로 두고 화면에서 "–"
// - 패드 코드: normalizePadId(옛 이름 HI_TOM → SMALL_TOM). 모르는 패드는 버린다
// - 노트 시각: PERFECT·GOOD은 tMs − deltaMs, MISS는 tMs. seq는 시간순이 아니므로 모두 받은 뒤 정렬한다
import type { Judgement } from '@/domain/judgement';
import { normalizePadId } from '@/domain/pads';
import type { AnalysisStatus, Report, ReportNote } from '@/domain/report';
import { apiFetch } from './http';

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
  inputSource: string;
  endReason: string | null;
  analysisStatus: AnalysisStatus;
  weakSegments: unknown;
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
    inputSource: dto.inputSource,
    analysisStatus: dto.analysisStatus,
    weakSegments: dto.weakSegments,
    recommendedDrills: dto.recommendedDrills,
    generatedAt: dto.generatedAt,
  };
}

export function toReportNote(dto: ReportNoteDto): ReportNote | null {
  const pad = normalizePadId(dto.pad);
  if (!pad) return null;
  const timeMs = dto.judgement !== 'MISS' && dto.deltaMs !== null ? dto.tMs - dto.deltaMs : dto.tMs;
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

/** 노트 전부를 nextAfterSeq가 null이 될 때까지 받아 시간순으로. first가 있으면 첫 페이지 요청을 건너뛴다(미리 받기) */
export async function getAllReportNotes(playId: string, opts: { first?: ReportNotesDto; signal?: AbortSignal } = {}): Promise<ReportNote[]> {
  const out: ReportNote[] = [];
  let page = opts.first ?? (await getReportNotesPage(playId, null, 1000, opts.signal));
  for (;;) {
    for (const d of page.items) {
      const n = toReportNote(d);
      if (n) out.push(n);
    }
    if (page.nextAfterSeq === null) break;
    page = await getReportNotesPage(playId, page.nextAfterSeq, 1000, opts.signal);
  }
  return out.sort((a, b) => a.timeMs - b.timeMs || a.seq - b.seq);
}
