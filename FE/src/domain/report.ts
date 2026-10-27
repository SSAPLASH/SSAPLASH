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
  /** 158 이후 AI 결과. 아직 해석하지 않는다(null과 []를 구분해 그대로 보관) */
  weakSegments: unknown;
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
