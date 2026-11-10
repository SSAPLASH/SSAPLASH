// 곡 목록·상세·채보 로드 (설계 2·4-1). 출처는 빌드 플래그: VITE_SONGS_SOURCE=builtin이면 BE 없이 내장 3곡.
// 내장 소스의 id 규칙: 곡·채보 id 모두 -(BUILTIN_CHARTS 인덱스 + 1). chartVersionId는 null.
import { create } from 'zustand';
import { getChartAssets, getChartLatest } from '@/api/charts';
import { ApiError } from '@/api/http';
import { getSong, listAllSongs } from '@/api/songs';
import { queryClient } from '@/app/queryClient';
import { songKeys } from '@/api/queries/songs';
import { builtinSummary, listBuiltinSongs } from '@/domain/builtinSongs';
import { BUILTIN_CHARTS, builtinId, type Chart } from '@/domain/chart';
import { chartFromDetail, type ChartAssetsDto } from '@/domain/chartMapping';
import type { SongDetail, SongLevel, SongScope, SongSummary } from '@/domain/songCatalog';

export type SongsSource = 'api' | 'builtin';
export type SongsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 목록 조건(설계 CHART-001 곡 난이도 3-3). 생략하면 전체·필터 없음 */
export interface SongListFilter {
  songLevel?: SongLevel;
  /** 곡 선택·추천만 켠다. 내 곡(/studio)은 켜지 않는다 */
  playableOnly?: boolean;
}

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
  scope: SongScope;
  items: SongSummary[];
  status: SongsStatus;
  error: string | null;

  /** 목록을 읽는다. 늦게 도착한 이전 요청 결과는 버린다 */
  load: (scope: SongScope, q?: string, filter?: SongListFilter) => Promise<void>;
  /** 곡 상세(난이도별 채보 요약 포함) */
  selectSong: (id: number) => Promise<SongDetail>;
  /**
   * 목록의 같은 id 곡에 다시 읽은 상세의 상태 필드(status·hasAccompaniment·accompanimentStatus·songLevel)만 반영한다(설계 CHART-002 반주 상태 3-3).
   * 채보가 끝나면 곡 난이도가 생기므로 songLevel도 함께 옮긴다(설계 CHART-001 곡 난이도 3-3).
   * 상세 응답에는 difficulties 등 목록 전용 값이 비어 올 수 있어 나머지는 그대로 둔다. 로딩 상태는 바꾸지 않는다
   */
  patchItem: (song: SongSummary) => void;
}

let seq = 0;

/** 다시 읽은 상세의 상태 필드만 옮긴다 */
function patchStatus(s: SongSummary, song: SongSummary): SongSummary {
  return {
    ...s,
    status: song.status,
    hasAccompaniment: song.hasAccompaniment,
    accompanimentStatus: song.accompanimentStatus,
    songLevel: song.songLevel,
  };
}

export const useSongs = create<SongsState>()((set, get) => ({
  source: SONGS_SOURCE,
  scope: 'BUILTIN',
  items: [],
  status: 'idle',
  error: null,

  load: async (scope, q, filter) => {
    const my = ++seq;
    set({ scope, status: 'loading', error: null });
    try {
      let items: SongSummary[];
      if (get().source === 'builtin') {
        items = listBuiltinSongs(scope, q, filter?.songLevel);
      } else {
        // 표가 전체 배열을 쪽으로 나누므로 hasNext가 끝날 때까지 모두 읽는다(Jira 363)
        items = await listAllSongs(
          { source: scope, q, songLevel: filter?.songLevel, playableOnly: filter?.playableOnly },
          { isStale: () => my !== seq },
        );
      }
      if (my !== seq) return;
      set({ items, status: 'ready' });
      // 내 곡을 다시 읽었다 = /studio에서 업로드·삭제·수정이 있었다. 곡 선택 화면의 목록 캐시도 새로 받게 한다(설계 TECH-350 U1)
      if (scope === 'MINE') void queryClient.invalidateQueries({ queryKey: songKeys.all });
    } catch (e) {
      if (my !== seq) return;
      set({ items: [], status: 'error', error: messageOf(e) });
    }
  },

  selectSong: async (id) => {
    if (get().source === 'builtin') {
      const d = builtinDetail(id);
      if (!d) throw new Error('곡을 찾을 수 없습니다.');
      return d;
    }
    return getSong(id);
  },

  patchItem: (song) => {
    const patch = (list: SongSummary[]): SongSummary[] => list.map((s) => (s.id === song.id ? patchStatus(s, song) : s));
    set((st) => ({ items: patch(st.items) }));
    // 곡 선택 화면의 목록 캐시도 같은 곡 상태를 맞춘다(설계 TECH-350 U3)
    queryClient.setQueriesData<SongSummary[]>({ queryKey: songKeys.lists() }, (old) => (old ? patch(old) : old));
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
