// 곡 상세·채보 로드와 곡 소스 (설계 2·4-1). 곡 목록은 서버 데이터 캐시(api/song/songQueries)가 읽는다(설계 TECH-351). 출처는 빌드 플래그: VITE_SONGS_SOURCE=builtin이면 BE 없이 내장 3곡.
// 내장 소스의 id 규칙: 곡·채보 id 모두 -(BUILTIN_CHARTS 인덱스 + 1). chartVersionId는 null.
import { create } from 'zustand';
import { getChartAssets, getChartLatest } from '@/api/song/charts';
import { ApiError } from '@/api/http';
import { getSong } from '@/api/song/songs';
import { builtinSummary } from '@/domain/song/builtinSongs';
import { BUILTIN_CHARTS, builtinId, type Chart } from '@/domain/song/chart';
import { chartFromDetail, type ChartAssetsDto } from '@/domain/song/chartMapping';
import type { SongDetail, SongScope } from '@/domain/song/songCatalog';

export type SongsSource = 'api' | 'builtin';

export const SONGS_SOURCE: SongsSource = import.meta.env.VITE_SONGS_SOURCE === 'builtin' ? 'builtin' : 'api';

export { builtinId };
const builtinIndex = (id: number): number => -id - 1;

function builtinChart(id: number): Chart | null {
  return BUILTIN_CHARTS[builtinIndex(id)] ?? null;
}

function builtinDetail(id: number): SongDetail | null {
  const c = builtinChart(id);
  if (!c) return null;
  return {
    ...builtinSummary(c, builtinIndex(id)),
    license: null,
    updatedAt: null,
    charts: [{ id, difficulty: c.difficulty, chartVersionId: null, version: 1, noteCount: c.notes.length, notationStatus: 'UNAVAILABLE' }],
  };
}

/** 오류를 화면에 보일 문장으로. ApiError는 BE가 준 한국어 detail 그대로 */
function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error && e.message) return e.message;
  return '알 수 없는 오류가 발생했습니다.';
}

interface SongsState {
  source: SongsSource;
  /** 곡 선택 창이 마지막으로 연 목록 탭. 다음 진입의 기본 탭이 된다(설계 TECH-350 U4). 목록 자체는 서버 데이터 캐시(api/song/songQueries)가 갖는다 */
  scope: SongScope;
  /** 곡 상세(난이도별 채보 요약 포함) */
  selectSong: (id: number) => Promise<SongDetail>;
}

export const useSongs = create<SongsState>()((_set, get) => ({
  source: SONGS_SOURCE,
  scope: 'BUILTIN',

  selectSong: async (id) => {
    if (get().source === 'builtin') {
      const d = builtinDetail(id);
      if (!d) throw new Error('곡을 찾을 수 없습니다.');
      return d;
    }
    return getSong(id);
  },
}));

export interface LoadedChart {
  chart: Chart;
  /** 자산 조회 실패 또는 내장 소스면 null */
  assets: ChartAssetsDto | null;
}

/**
 * 곡 선택 직후 채보를 읽는다. api: 최신 버전 → Chart 변환 → 자산(실패해도 chart는 돌려준다).
 * 플레이 시작 후 버전 고정은 호출자가 `chart.chartVersionId`를 들고 있는 것으로 처리한다(캐시하지 않음).
 * 실패하면 오류 문장(ApiError.detail)을 message로 가진 Error를 던진다.
 */
export async function loadChart(args: { songId: number; chartId: number }, signal?: AbortSignal): Promise<LoadedChart> {
  if (SONGS_SOURCE === 'builtin') {
    const chart = builtinChart(args.chartId);
    if (!chart) throw new Error('채보를 찾을 수 없습니다.');
    return { chart, assets: null };
  }
  try {
    const detail = await getChartLatest(args.chartId, signal);
    const chart = chartFromDetail(detail, false);
    let assets: ChartAssetsDto | null = null;
    try {
      assets = await getChartAssets(detail.chartVersionId, signal);
    } catch {
      // 자산(반주·악보 이미지)이 없어도 채보는 연주할 수 있다
    }
    if (assets?.accompanimentUrl) chart.hasAccompaniment = true;
    return { chart, assets };
  } catch (e) {
    throw new Error(messageOf(e), { cause: e });
  }
}
