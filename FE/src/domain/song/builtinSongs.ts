// 내장 곡(VITE_SONGS_SOURCE=builtin) 목록 규칙. songStore와 곡 목록 쿼리가 같이 쓴다.
// id 규칙: 곡·채보 id 모두 -(BUILTIN_CHARTS 인덱스 + 1).
import { BUILTIN_CHARTS, builtinId, type Chart } from './chart';
import type { SongLevel, SongScope, SongSummary } from './songCatalog';

export function builtinSummary(c: Chart, index: number): SongSummary {
  return {
    id: builtinId(index),
    title: c.title,
    artist: '기본 제공',
    source: 'BUILTIN',
    status: 'READY',
    bpm: c.bpm,
    timeSignature: `${c.beatsPerBar}/4`,
    durationMs: c.durationMs,
    hasAccompaniment: false,
    accompanimentStatus: 'NONE',
    // 내장 곡은 BE 산정 대상이 아니고 FE는 난이도를 계산하지 않는다
    songLevel: null,
    difficulties: [c.difficulty],
    createdAt: '',
    coverUrl: null,
    sheetId: null,
  };
}

/** 내장 곡 목록. 내 곡은 없다. 내장 곡은 난이도가 없으므로(null) playableOnly는 무시하고 난이도 필터만 흉내 낸다 */
export function listBuiltinSongs(scope: SongScope, q?: string, songLevel?: SongLevel): SongSummary[] {
  if (scope === 'MINE') return [];
  const needle = q?.trim().toLowerCase() ?? '';
  return BUILTIN_CHARTS.map(builtinSummary).filter(
    (s) => (!needle || s.title.toLowerCase().includes(needle)) && (!songLevel || s.songLevel === songLevel),
  );
}
