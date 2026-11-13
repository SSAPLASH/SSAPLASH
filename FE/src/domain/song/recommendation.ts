// 추천 곡 R1·비슷한 곡 R2 도메인 (설계 COACH-004-song-recommend-picker 3-2, COACH-004-similar-songs 3-2). 타입·문구 표·카드 모델·BE 응답 변환.
import type { Difficulty } from '@/domain/song/chart';
import { pickPathOf } from '@/domain/play/playRetry';
import { DIFFICULTY_ORDER, songFromDto, toSafeId, type SongLevel, type SongSummary } from '@/domain/song/songCatalog';

/** 추천 노출 위치 */
export type RecommendationContext = 'SONG_PICKER' | 'REPORT' | 'DRILL';

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
  /** DRILL 추천의 연습 대상. 이전 응답에는 없다 */
  focus?: { pattern: string; pads: string[] };
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
  const focus = d.focus && typeof d.focus === 'object' && !Array.isArray(d.focus) ? d.focus as Record<string, unknown> : null;
  return {
    song: songFromDto((d.song ?? {}) as Record<string, unknown>),
    chartId: toSafeId(d.chartId, 'chartId'),
    difficulty: difficultyOf(d.difficulty),
    reasons,
    ...(focus ? { focus: { pattern: String(focus.pattern ?? ''), pads: Array.isArray(focus.pads) ? focus.pads.map(String) : [] } } : {}),
  };
}

/** 추천·비슷한 곡 공용 카드 한 장(R2 설계 D7). `line`은 이유·비슷한 이유 한 줄이고 빈 문자열이면 줄을 그리지 않는다 */
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

export interface SimilarItem {
  song: SongSummary;
  chartId: number;
  difficulty: Difficulty;
  /** 보관만 한다 — 화면에 보이지 않는다(D6) */
  similarity: number;
  /** 열린 문자열 코드 */
  matchedOn: string[];
}

export interface SimilarPage {
  requestId: string;
  strategy: string;
  items: SimilarItem[];
}

/** 비슷한 이유 코드별 FE 문구(R2 설계 3-2). 표에 없는 코드는 문구 없음 */
export const MATCHED_ON_COPY: Record<string, string> = {
  RHYTHM: '리듬이 비슷해요',
  PADS: '쓰는 패드가 비슷해요',
  TRANSITIONS: '손의 움직임이 비슷해요',
  DENSITY: '연주 강도가 비슷해요',
  TEMPO: '템포가 비슷해요',
};

/** 첫 코드의 문구. 첫 코드가 표에 없으면 다음 코드를 보지 않고 빈 문자열(D6) */
export function matchedOnText(codes: string[]): string {
  const first = codes[0];
  return first !== undefined && Object.hasOwn(MATCHED_ON_COPY, first) ? MATCHED_ON_COPY[first] : '';
}

/** R2 항목 → 카드(문구 = 비슷한 이유) */
export function similarCardOf(item: SimilarItem): RecommendCard {
  return { song: item.song, chartId: item.chartId, difficulty: item.difficulty, line: matchedOnText(item.matchedOn) };
}

export function similarFromDto(d: Record<string, unknown>): SimilarItem {
  const similarity = Number(d.similarity);
  return {
    song: songFromDto((d.song ?? {}) as Record<string, unknown>),
    chartId: toSafeId(d.chartId, 'chartId'),
    difficulty: difficultyOf(d.difficulty),
    similarity: Number.isFinite(similarity) ? similarity : 0,
    matchedOn: Array.isArray(d.matchedOn) ? d.matchedOn.map(String) : [],
  };
}

/**
 * 추천 카드를 눌렀을 때 이동할 경로(설계 COACH-004-song-recommend-report D5).
 * `mode`는 리포트 모드 문자열 그대로 — SHEET만 `/sheet`(곡·단계를 골라 둔 채 시작 확인 창을 연다, `start=1`), 그 밖은 `/play`(곡·단계를 골라 둔 곡 선택, 시작은 사용자가 ▶ 플레이로).
 */
export function recommendationPathOf(card: { song: { id: number }; chartId: number }, mode: string): string {
  const path = `${pickPathOf(mode)}?song=${card.song.id}&chart=${card.chartId}`;
  return mode === 'SHEET' ? `${path}&start=1` : path;
}

/**
 * 곡 선택 [AI 추천곡] 탭의 검색·곡 난이도 칩(설계 COACH-004-song-picker-ai-tab 3-2). 받은 R1 목록을 FE에서 거르고 순서는 그대로 둔다.
 * 검색어는 앞뒤 공백을 빼고 대소문자 없이 제목·아티스트 부분 일치, `level`이 null이면 난이도로 거르지 않는다.
 */
export function filterRecommended(cards: readonly RecommendCard[], query: string, level: SongLevel | null): RecommendCard[] {
  const q = query.trim().toLowerCase();
  return cards.filter(
    (c) =>
      (level === null || c.song.songLevel === level) &&
      (q === '' || c.song.title.toLowerCase().includes(q) || c.song.artist.toLowerCase().includes(q)),
  );
}

/** 선택한 곡 패널에 보일 비슷한 곡 한 건 — 선택한 곡과 다른 첫 카드(설계 COACH-004-song-picker-ai-tab 3-2) */
export function pickSimilar(cards: readonly RecommendCard[], selectedId: number): RecommendCard | undefined {
  return cards.find((c) => c.song.id !== selectedId);
}
