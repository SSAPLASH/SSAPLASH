// 플레이 리포트 화면 타입 (COACH-002). 서버 응답 변환은 api/reports, 정확도는 0~1, 표본 없음은 null.
import type { Judgement } from './judgement';
import type { PadId } from './pads';

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
  inputSource: string;
  analysisStatus: AnalysisStatus;
  /** AI 약점 구간. null = 미분석·실패, [] = 분석했으나 약점 없음 */
  weakSegments: WeakSegment[] | null;
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
