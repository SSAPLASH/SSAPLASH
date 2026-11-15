// 플레이 리포트 화면 타입 (COACH-002). 서버 응답 변환은 api/play/reports, 정확도는 0~1, 표본 없음은 null.
import type { Difficulty } from '@/domain/song/chart';
import type { Judgement } from './judgement';
import type { PadId } from '@/domain/kit/pads';

export type AnalysisStatus = 'NOT_REQUESTED' | 'PENDING' | 'DONE' | 'FAILED';

export interface PadStat {
  pad: PadId;
  /** 0~1. 판정 표본이 없으면 null */
  accuracy: number | null;
  meanDeltaMs: number | null;
  meanVelocity: number | null;
  counts: Record<Judgement, number>;
  /** PERFECT+GOOD 수(Δ·세기 평균의 표본) */
  sampleCount: number;
}

export type WeakScope = 'WHOLE' | 'SEGMENT';

/** AI 약점 심각도 단계 (COACH-003). 없으면 severity로 폴백한다 */
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** severityLevel이 없을 때 이 값 이상이면 HIGH로 본다 */
export const SEVERE_THRESHOLD = 0.7;

/** AI 약점 구간 한 건 (COACH-003). description을 그대로 표시하고 pattern으로 분기하지 않는다 */
export interface WeakSegment {
  /** 노트 시각 기준 ms, 시작 포함·끝 미포함 */
  fromMs: number;
  toMs: number;
  pattern: string;
  description: string;
  causeTags: string[];
  pads: PadId[];
  /** AI 연습 조언(선택). 문구를 고치지 않고 그대로 표시한다 */
  tip?: string;
  /** AI 상세 설명(선택). 문구를 고치지 않고 그대로 표시한다 */
  detail?: string;
  /** AI 심각도 단계(선택). 없으면 segmentLevel이 severity로 폴백한다 */
  severityLevel?: SeverityLevel;
  /** 0~1 */
  severity: number;
  scope: WeakScope;
  /** severity·scope를 뺀 나머지 키(자유 형식, 보관만) */
  metrics: Record<string, unknown>;
}

/** 판정 수 합(PERFECT+GOOD+MISS)이 이 값보다 적으면 서버가 짧은 곡으로 보고 분석하지 않는다(AI 확정, 10/28 회신 2) */
export const MIN_NOTES_FOR_ANALYSIS = 20;

/** 구간을 마디 번호(0부터, 양쪽 포함)로 환산한다. bpm·박자가 없으면 null. feedback.ts의 barOf와 같은 식 */
export function segmentBars(fromMs: number, toMs: number, bpm: number, beatsPerBar: number): [number, number] | null {
  if (!(bpm > 0) || !(beatsPerBar > 0)) return null;
  const barMs = (60000 / bpm) * beatsPerBar;
  // 끝 미포함이므로 마지막 포함 시각 toMs − 1이 속한 마디. 시작은 feedback.ts의 barOf와 같은 식
  const fromBar = Math.max(0, Math.floor((fromMs + 1) / barMs));
  const toBar = Math.max(fromBar, Math.floor((toMs - 1) / barMs));
  return [fromBar, toBar];
}

/** 약점의 심각도 단계. severityLevel이 있으면 그대로, 없으면 severity ≥ 0.7이 HIGH, 아니면 LOW */
export function segmentLevel(seg: WeakSegment): SeverityLevel {
  if (seg.severityLevel) return seg.severityLevel;
  return seg.severity >= SEVERE_THRESHOLD ? 'HIGH' : 'LOW';
}

/** 심각도 뱃지. LOW는 뱃지 없음 */
export function levelBadge(level: SeverityLevel): { text: string; tone: 'miss' | 'warn' } | null {
  if (level === 'HIGH') return { text: '주의', tone: 'miss' };
  if (level === 'MEDIUM') return { text: '보통', tone: 'warn' };
  return null;
}

/** 총평 레벨 뱃지. 모르는 값은 null(본문만 표시) */
export function summaryBadge(level: string): { text: string; tone: 'perfect' | 'good' | 'miss' } | null {
  switch (level) {
    case 'GOOD':
      return { text: '좋아요', tone: 'perfect' };
    case 'FAIR':
      return { text: '괜찮아요', tone: 'good' };
    case 'NEEDS_WORK':
      return { text: '연습이 필요해요', tone: 'miss' };
    default:
      return null;
  }
}

/** ms → 「m:ss」(초 내림). 음수·NaN은 「0:00」 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 약점 카드 패널의 구간 문구. 마디는 0부터라 +1해서 보인다 */
export function segmentRangeText(seg: WeakSegment, bars: [number, number] | null, durationMs: number | null): string {
  if (seg.scope === 'WHOLE') return `곡 전체 · 0:00 – ${formatClock(durationMs ?? seg.toMs)}`;
  const clock = `${formatClock(seg.fromMs)} – ${formatClock(seg.toMs)}`;
  if (!bars) return clock;
  const [from, to] = bars;
  return `${from === to ? `${from + 1}마디` : `${from + 1}~${to + 1}마디`} · ${clock}`;
}

/** 판정 수 합이 분석 최소 노트 수 미만인지 */
export function isTooShortForAnalysis(counts: Record<Judgement, number>): boolean {
  return counts.PERFECT + counts.GOOD + counts.MISS < MIN_NOTES_FOR_ANALYSIS;
}

/** 결과 화면 진입부 설명 문구 (COACH-003 4-3). null이면 호출 쪽이 기존 설명을 유지한다 */
export function analysisTeaser(report: Report | null): string | null {
  if (!report) return null;
  const failedText = 'AI 분석은 만들지 못했어요 · 패드별 정확도·타이밍은 볼 수 있어요';
  switch (report.analysisStatus) {
    case 'PENDING':
      return 'AI가 연주를 분석하고 있어요';
    case 'FAILED':
      return failedText;
    case 'DONE': {
      const segs = report.weakSegments;
      if (segs === null) return failedText;
      if (segs.length > 0) return `AI가 약점 ${segs.length}곳을 찾았어요`;
      return isTooShortForAnalysis(report.counts) ? '곡이 짧아 분석하지 않았어요' : 'AI 분석 완료 · 뚜렷한 약점 없음';
    }
    default:
      return null;
  }
}

/**
 * 업로드 대상 플레이인지 (COACH-003 4-3). 참이면 결과 화면은 로컬 피드백 대신 서버 분석을 쓴다.
 * 업로드 상태가 아직 없으면(업로드 시작 전) 대상으로 본다. 이전 형식 로그·생략·재시도 불가 실패는 대상이 아니다
 */
export function isUploadTarget(legacy: boolean, state: { status: string; retryable: boolean } | undefined): boolean {
  if (legacy) return false;
  if (state?.status === 'SKIPPED') return false;
  return !(state?.status === 'FAILED' && !state.retryable);
}

/** AI 총평 (COACH-003). level·source는 문자열 그대로 보관하고 검증은 화면에서 한다 */
export interface CoachSummary {
  level: string;
  text: string;
  focusPattern: string | null;
  source: string | null;
}

export interface Report {
  playId: string;
  score: number;
  /** 0~1 */
  accuracy: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  /** 칸 i의 범위 = fromMs + i × binMs 부터 binMs. 없으면 null */
  histogram: { binMs: number; fromMs: number; counts: number[] } | null;
  padStats: PadStat[];
  mode: string;
  /** 연주한 곡·채보·연습 단계. BE 응답에 아직 없으면 null(리포트 하단 비슷한 곡이 이 값이 있을 때만 보인다) */
  songId: number | null;
  chartId: number | null;
  difficulty: Difficulty | null;
  inputSource: string;
  /** 연주 배율(연습 속도, 0~1). 원래 빠르기·옛 기록은 1 */
  playbackRate: number;
  analysisStatus: AnalysisStatus;
  /** AI 약점 구간. null = 미분석·실패, [] = 분석했으나 약점 없음 */
  weakSegments: WeakSegment[] | null;
  /** AI 총평. null = 없음(미분석·구버전 응답) */
  coachSummary: CoachSummary | null;
  recommendedDrills: unknown;
  generatedAt: string;
}

export interface ReportNote {
  seq: number;
  noteId: string | null;
  /** 노트(채보) 시각 ms */
  timeMs: number;
  pad: PadId;
  judgement: Judgement;
  deltaMs: number | null;
  velocity: number | null;
}
