// 곡 선택 표 (Figma SongRow 126:3485 default·hover·selected). 열 · 커버 · 제목/아티스트 · BPM · 길이 · 곡 난이도 · 최고 점수(sheet 모드는 최고 정확도).
// 행 클릭 = 선택, 더블클릭·Enter = 준비. 위·아래 키로 행 이동. 한 페이지 6곡, 쪽 번호는 ui/Pagination(10개 묶음). 곡 로딩은 호출자가 한다(props만 받는다).
// 추천 곡(isRecommended)은 제목 옆에 「✦ AI 추천」 라벨을 붙인다 — 제목만 말줄임하고 라벨은 줄이지 않는다(Figma SongRow `AI 추천 라벨`, 설계 COACH-004-song-picker-ai-tab 3-3).
// 곡이 없으면 머리글과 아래 줄(「총 0곡」)은 두고 본문 자리 가운데에 emptyState를 그린다(Figma 666:33746).
// 즐겨찾기(설계 MODE-001-MODE-003-song-favorite): favoriteIds·onToggleFavorite를 받으면 맨 오른쪽에 별 열이 붙는다. 선택 행의 별만 Tab 순서에 들고, 행에 포커스가 있을 때 F 키로도 바꾼다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { artistLabel, songLevelLabel, songStatusView, type SongSummary } from '@/domain/song/songCatalog';
import { formatDuration } from '@/domain/time/formatTime';
import { formatAccuracy } from '@/engine/playLog';
import { SongCover } from '@/components/song/SongCover';
import { Pagination } from '@/components/ui/layout/Pagination';
import { FavoriteButton } from './FavoriteButton';
import '@/components/ui/layout/table.css';
import './song-table.css';

export const SONG_TABLE_PAGE_SIZE = 6;

interface Column {
  key: string;
  header: string;
  className?: string;
  render: (song: SongSummary, ctx: { best: number | undefined; locked: boolean; recommended: boolean }) => ReactNode;
}

const DASH = '—';

/** 기록 열: play는 최고 점수, sheet는 최고 정확도(0~1) */
function bestColumn(mode: 'play' | 'sheet'): Column {
  return mode === 'sheet'
    ? {
        key: 'best',
        header: '정확도',
        className: 'play-st-num',
        render: (_s, { best }) => (best === undefined ? DASH : formatAccuracy(best)),
      }
    : {
        key: 'best',
        header: '최고 점수',
        className: 'play-st-num',
        render: (_s, { best }) => (best === undefined ? DASH : best.toLocaleString('ko-KR')),
      };
}

/** 열 정의. 곡 난이도는 연습 단계 배지와 섞이지 않게 글자로만 쓴다(설계 CHART-001 곡 난이도 1) */
const BASE_COLUMNS: Column[] = [
  {
    key: 'cover',
    header: '커버',
    className: 'play-st-cover',
    render: (s) => <SongCover coverUrl={s.coverUrl} className="play-st-cover-img" />,
  },
  {
    key: 'title',
    header: '제목 / 아티스트',
    className: 'play-st-title',
    render: (s, { locked, recommended }) => (
      <>
        <span className="play-st-titleline">
          <span className="play-st-name">{s.title}</span>
          {recommended && <span className="play-st-ai">✦ AI 추천</span>}
        </span>
        <span className="play-st-artist">
          {artistLabel(s.artist)}
          {locked && <span className={`play-st-status ${songStatusView(s.status).tone}`}>{songStatusView(s.status).label}</span>}
        </span>
      </>
    ),
  },
  { key: 'bpm', header: 'BPM', className: 'play-st-num', render: (s) => Math.round(s.bpm) },
  {
    key: 'len',
    header: '길이',
    className: 'play-st-num',
    render: (s) => (s.durationMs === null ? DASH : formatDuration(s.durationMs)),
  },
  { key: 'level', header: '곡 난이도', className: 'play-st-level', render: (s) => songLevelLabel(s.songLevel) },
];

const COLUMNS_BY_MODE = {
  play: [...BASE_COLUMNS, bestColumn('play')],
  sheet: [...BASE_COLUMNS, bestColumn('sheet')],
};

interface Props {
  songs: readonly SongSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** 더블클릭·Enter */
  onOpen: (id: number) => void;
  /** play(기본)는 최고 점수, sheet는 최고 정확도 열을 보인다 */
  mode?: 'play' | 'sheet';
  /** 곡 id → 최고 점수(play 모드, 없으면 "—") */
  bestScores?: ReadonlyMap<number, number>;
  /** 곡 id → 최고 정확도 0~1(sheet 모드, 없으면 "—") */
  bestAccuracies?: ReadonlyMap<number, number>;
  /** true면 고를 수 없는 곡(처리 중·실패) */
  isLocked?: (song: SongSummary) => boolean;
  /** true면 제목 옆에 「✦ AI 추천」 라벨 */
  isRecommended?: (song: SongSummary) => boolean;
  /** 곡이 없을 때 본문 가운데 내용 */
  emptyState?: ReactNode;
  /** 처음 보일 때 이 곡이 있는 쪽을 연다(주소로 골라 둔 곡: 다시 하기·추천·세팅 복귀). 사용자가 쪽을 넘기면 더 따르지 않는다 */
  revealId?: number | null;
  /** 즐겨찾기한 곡 id. onToggleFavorite와 함께 받으면 맨 오른쪽에 별 열을 그린다 */
  favoriteIds?: ReadonlySet<number>;
  onToggleFavorite?: (id: number) => void;
  /** 아래 줄 곡 수 앞말(「{countLabel} N곡」). 기본 「총」 */
  countLabel?: string;
}

export function SongTable({
  songs,
  selectedId,
  onSelect,
  onOpen,
  mode = 'play',
  bestScores,
  bestAccuracies,
  isLocked,
  isRecommended,
  emptyState,
  revealId = null,
  favoriteIds,
  onToggleFavorite,
  countLabel = '총',
}: Props) {
  const columns = COLUMNS_BY_MODE[mode];
  const favorites = favoriteIds !== undefined && onToggleFavorite !== undefined ? { ids: favoriteIds, toggle: onToggleFavorite } : null;
  const bests = mode === 'sheet' ? bestAccuracies : bestScores;
  // null = 아직 쪽을 넘기지 않음. 그동안은 revealId 곡이 있는 쪽(없으면 첫 쪽)을 보인다
  const [rawPage, setPage] = useState<number | null>(null);
  const pageCount = Math.max(1, Math.ceil(songs.length / SONG_TABLE_PAGE_SIZE));
  const revealIndex = revealId === null ? -1 : songs.findIndex((s) => s.id === revealId);
  const page = Math.min(rawPage ?? (revealIndex < 0 ? 0 : Math.floor(revealIndex / SONG_TABLE_PAGE_SIZE)), pageCount - 1);
  const pending = useRef<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const locked = (s: SongSummary) => isLocked?.(s) ?? false;
  const rows = songs.slice(page * SONG_TABLE_PAGE_SIZE, (page + 1) * SONG_TABLE_PAGE_SIZE);
  // 선택 행이 이 쪽에 없으면 첫 선택 가능 행이 탭 순서를 받는다
  const tabStopId = rows.some((s) => s.id === selectedId) ? selectedId : (rows.find((s) => !locked(s))?.id ?? null);

  // 키로 옮긴 선택은 쪽이 바뀐 뒤에 포커스를 따라가게 한다
  useEffect(() => {
    if (pending.current === null) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-song-id="${pending.current}"]`);
    pending.current = null;
    el?.focus();
  }, [selectedId, page]);

  const move = (step: 1 | -1) => {
    const base = songs.findIndex((s) => s.id === selectedId);
    let i = base < 0 ? (step === 1 ? -1 : songs.length) : base;
    for (;;) {
      i += step;
      if (i < 0 || i >= songs.length) return;
      if (!locked(songs[i])) break;
    }
    pending.current = songs[i].id;
    setPage(Math.floor(i / SONG_TABLE_PAGE_SIZE));
    onSelect(songs[i].id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div className="play-st">
      <table className="ui-table play-st-table" role="grid" aria-label="곡 목록">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
            {favorites && <th scope="col" className="play-st-fav" aria-label="즐겨찾기" />}
          </tr>
        </thead>
        <tbody ref={bodyRef} onKeyDown={onKeyDown}>
          {songs.length === 0 && (
            <tr className="play-st-empty">
              <td colSpan={columns.length + (favorites ? 1 : 0)}>{emptyState}</td>
            </tr>
          )}
          {rows.map((song) => {
            const isLock = locked(song);
            const selected = song.id === selectedId;
            return (
              <tr
                key={song.id}
                data-song-id={song.id}
                className={['play-st-row', selected ? 'selected' : '', isLock ? 'locked' : ''].filter(Boolean).join(' ')}
                aria-selected={selected}
                aria-disabled={isLock || undefined}
                tabIndex={song.id === tabStopId && !isLock ? 0 : -1}
                onClick={() => !isLock && onSelect(song.id)}
                onDoubleClick={() => !isLock && onOpen(song.id)}
                onKeyDown={(e) => {
                  if (isLock || e.target !== e.currentTarget) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onOpen(song.id);
                  } else if (favorites && e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    // 한글 자판에서도 같은 자리 키로 동작하게 글자(key)가 아니라 자리(code)를 본다
                    e.preventDefault();
                    favorites.toggle(song.id);
                  }
                }}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(song, { best: bests?.get(song.id), locked: isLock, recommended: isRecommended?.(song) ?? false })}
                  </td>
                ))}
                {favorites && (
                  <td className="play-st-fav">
                    {!isLock && (
                      <FavoriteButton
                        on={favorites.ids.has(song.id)}
                        onToggle={() => favorites.toggle(song.id)}
                        tabIndex={song.id === tabStopId ? 0 : -1}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="play-st-foot">
        <span className="play-st-total">
          {countLabel} {songs.length}곡
        </span>
        <Pagination page={page} pageCount={pageCount} onChange={setPage} label="곡 목록 쪽" />
      </div>
    </div>
  );
}
