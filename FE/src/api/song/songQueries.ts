// 곡 목록 쿼리 키·조회 옵션 (설계 TECH-350 3절). 키 앞부분 ['songs']로 곡 관련 캐시를 한꺼번에 무효화한다.
import { queryOptions } from '@tanstack/react-query';
import { listBuiltinSongs } from '@/domain/song/builtinSongs';
import type { SongLevel, SongScope, SongSummary } from '@/domain/song/songCatalog';
import { listAllSongs } from './songs';

export interface SongListParams {
  scope: SongScope;
  q?: string;
  songLevel?: SongLevel;
  playableOnly?: boolean;
}

export const songKeys = {
  all: ['songs'] as const,
  lists: () => ['songs', 'list'] as const,
  list: (p: SongListParams) =>
    ['songs', 'list', { scope: p.scope, q: p.q?.trim() ?? '', songLevel: p.songLevel ?? null, playableOnly: p.playableOnly === true }] as const,
};

/**
 * 곡 목록 조회 옵션. builtin 소스면 BE 없이 내장 곡을 돌려준다.
 * 같은 탭(scope)에서 검색어·난이도만 바뀌는 동안 이전 목록을 유지한다(U2). 탭이 바뀌면 다른 탭 곡을 보이지 않는다
 */
export function songListQuery(p: SongListParams, source: 'api' | 'builtin') {
  return queryOptions<SongSummary[]>({
    queryKey: [...songKeys.list(p), source],
    queryFn: ({ signal }) =>
      source === 'builtin'
        ? Promise.resolve(listBuiltinSongs(p.scope, p.q, p.songLevel))
        : listAllSongs({ source: p.scope, q: p.q, songLevel: p.songLevel, playableOnly: p.playableOnly }, { signal }),
    placeholderData: (prev, prevQuery) => {
      const prevParams = prevQuery?.queryKey[2] as { scope?: SongScope } | undefined;
      return prevParams?.scope === p.scope ? prev : undefined;
    },
  });
}

/** 라이브러리(/studio) 내 곡 목록. 처리 중·실패 곡도 보여야 하므로 playableOnly를 켜지 않는다 (설계 TECH-351) */
export function mineSongsQuery(source: 'api' | 'builtin') {
  return songListQuery({ scope: 'MINE' }, source);
}

/** 다시 읽은 곡 상세의 상태 필드(status·반주·곡 난이도)만 목록 행에 옮긴다. 나머지(difficulties 등 목록 전용 값)는 그대로 둔다 */
export function patchSongStatus(list: SongSummary[], song: SongSummary): SongSummary[] {
  return list.map((s) =>
    s.id === song.id
      ? { ...s, status: song.status, hasAccompaniment: song.hasAccompaniment, accompanimentStatus: song.accompanimentStatus, songLevel: song.songLevel }
      : s,
  );
}
