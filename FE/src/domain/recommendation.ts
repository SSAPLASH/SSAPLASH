// 추천 곡 R1 도메인 (설계 COACH-004-song-recommend-picker 3-2, COACH-004-song-recommend-report 3-2). 타입·이유 문구 표·카드 모델·BE 응답 변환.
import type { Difficulty } from './chart';
import { pickPathOf } from './playRetry';
import { DIFFICULTY_ORDER, songFromDto, toSafeId, type SongSummary } from './songCatalog';

/** 노출 위치. 곡 선택은 SONG_PICKER, 리포트 하단은 후속 작업 */
export type RecommendationContext = 'SONG_PICKER' | 'REPORT';

export interface RecommendationReason {
  /** 열린 문자열 — BE가 코드를 늘려도 깨지지 않는다 */
  code: string;
  text: string;
}

export interface RecommendationItem {
  song: SongSummary;
  /** 추천된 채보. 카드를 누르면 URL `chart`로 간다 */
  chartId: number;
  difficulty: Difficulty;
  reasons: RecommendationReason[];
}

export interface RecommendationPage {
  requestId: string;
  /** 보관만 한다(R3 전환 대비) */
  strategy: string;
  items: RecommendationItem[];
}

/** 이유 코드별 FE 문구(D7). 표에 없는 코드는 BE text를 그대로 쓴다 */
export const REASON_COPY: Record<string, string> = {
  CHALLENGE: '지금 실력보다 조금 어려워요. 도전해 보세요',
  WEAK_PAD: '요즘 약한 패드가 많이 나와요',
  NEW_SONG: '아직 안 쳐 본 곡이에요',
  RETRY: '한 번 더 치면 목표 정확도에 닿아요',
  STARTER: '처음 시작하기 좋은 쉬운 곡이에요',
};

export function reasonText(reason: RecommendationReason): string {
  return Object.hasOwn(REASON_COPY, reason.code) ? REASON_COPY[reason.code] : reason.text;
}

/** 카드에 보일 이유 한 줄(첫 이유만). 이유가 없으면 빈 문자열 */
export function primaryReason(item: Pick<RecommendationItem, 'reasons'>): string {
  const first = item.reasons[0];
  return first ? reasonText(first) : '';
}

/** 모르는 연습 단계 값은 NORMAL로 본다(배지가 깨지지 않게) */
function difficultyOf(v: unknown): Difficulty {
  return (DIFFICULTY_ORDER as string[]).includes(String(v)) ? (v as Difficulty) : 'NORMAL';
}

function reasonFromDto(d: Record<string, unknown>): RecommendationReason {
  return { code: String(d.code ?? ''), text: String(d.text ?? '') };
}

export function recommendationFromDto(d: Record<string, unknown>): RecommendationItem {
  const reasons = Array.isArray(d.reasons) ? (d.reasons as Record<string, unknown>[]).map(reasonFromDto) : [];
  return {
    song: songFromDto((d.song ?? {}) as Record<string, unknown>),
    chartId: toSafeId(d.chartId, 'chartId'),
    difficulty: difficultyOf(d.difficulty),
    reasons,
  };
}

/** 추천 카드 한 장(비슷한 곡과 공유할 모델). `line`은 이유·비슷한 이유 한 줄이고 빈 문자열이면 줄을 그리지 않는다 */
export interface RecommendCard {
  song: SongSummary;
  chartId: number;
  difficulty: Difficulty;
  line: string;
}

/** R1 항목 → 카드(문구 = 첫 이유) */
export function cardOf(item: RecommendationItem): RecommendCard {
  return { song: item.song, chartId: item.chartId, difficulty: item.difficulty, line: primaryReason(item) };
}

/**
 * 추천 카드를 눌렀을 때 이동할 연주 준비 경로(설계 COACH-004-song-recommend-report D5).
 * `mode`는 리포트 모드 문자열 그대로 — SHEET만 `/sheet`, 그 밖은 `/play`.
 */
export function recommendationPathOf(card: { song: { id: number }; chartId: number }, mode: string): string {
  return `${pickPathOf(mode)}?song=${card.song.id}&chart=${card.chartId}`;
}
