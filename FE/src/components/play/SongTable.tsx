// 곡 선택 표 (Figma SongRow 126:3485 default·hover·selected). 열 · 커버 · 제목/아티스트 · BPM · 길이 · 최고 점수.
// 행 클릭 = 선택, 더블클릭·Enter = 준비. 위·아래 키로 행 이동. 한 페이지 6곡. 곡 로딩은 호출자가 한다(props만 받는다).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { songStatusView, type SongSummary } from '@/domain/songCatalog';
import { formatDuration } from '@/components/formatTime';
import { SongCover } from '@/components/song/SongCover';
import '@/components/ui/table.css';
import './song-table.css';

export const SONG_TABLE_PAGE_SIZE = 6;

interface Column {
  key: string;
  header: string;
  className?: string;
  render: (song: SongSummary, ctx: { bestScore: number | undefined; locked: boolean }) => ReactNode;
}

const DASH = '—';

/** 열 정의. 나중에 「곡 난이도」 칸을 추가하려면 배열에 한 줄만 넣는다(설계 U17) */
const COLUMNS: Column[] = [
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
    render: (s, { locked }) => (
      <>
        <span className="play-st-name">{s.title}</span>
        <span className="play-st-artist">
          {s.artist}
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
  {
    key: 'best',
    header: '최고 점수',
    className: 'play-st-num',
    render: (_s, { bestScore }) => (bestScore === undefined ? DASH : bestScore.toLocaleString('ko-KR')),
  },
];

interface Props {
  songs: SongSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** 더블클릭·Enter */
  onOpen: (id: number) => void;
  /** 곡 id → 최고 점수(없으면 "—") */
  bestScores: ReadonlyMap<number, number>;
  /** true면 고를 수 없는 곡(처리 중·실패) */
  isLocked?: (song: SongSummary) => boolean;
}

export function SongTable({ songs, selectedId, onSelect, onOpen, bestScores, isLocked }: Props) {
  const [rawPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(songs.length / SONG_TABLE_PAGE_SIZE));
  const page = Math.min(rawPage, pageCount - 1);
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
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef} onKeyDown={onKeyDown}>
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
                  if (e.key === 'Enter' && !isLock && e.target === e.currentTarget) {
                    e.preventDefault();
                    onOpen(song.id);
                  }
                }}
              >
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(song, { bestScore: bestScores.get(song.id), locked: isLock })}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="play-st-foot">
        <span className="play-st-total">총 {songs.length}곡</span>
        <nav className="play-st-pager" aria-label="곡 목록 쪽">
          <button type="button" className="play-st-pg" disabled={page === 0} onClick={() => setPage(page - 1)}>
            이전
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`play-st-pg${i === page ? ' current' : ''}`}
              aria-current={i === page ? 'page' : undefined}
              onClick={() => setPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button type="button" className="play-st-pg" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
            다음
          </button>
        </nav>
      </div>
    </div>
  );
}
