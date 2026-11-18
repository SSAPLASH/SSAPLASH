// 반주 고르기 창 (Figma 802:35314 · 모바일 시트 803:35356, 설계 MODE-002 4-5). 공용 곡·내 곡 섹션, 처음부터 검색, 섹션별 더 보기. 재생은 모른다.
// 데스크톱은 가운데 창, ≤640은 바텀 시트(is-sheet + 손잡이 막대). 지금 곡 행은 brand 칠 + PlayingEq(currentPlaying이면 움직임).
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { PlayingEq } from '@/components/song/PlayingEq';
import { SongCover } from '@/components/song/SongCover';
import { MOBILE_QUERY, useMediaQuery } from '@/components/shell/useMediaQuery';
import { CloseIcon } from '@/components/song/StudioIcons';
import { SongStatusBadge } from '@/components/song/SongStatusBadge';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { Input } from '@/components/ui/form/Input';
import { pickableForAccompaniment, type AccompanimentPick } from '@/domain/song/freeAccompaniment';
import { artistLabel, type SongSummary } from '@/domain/song/songCatalog';
import { useAccompanimentSongs, type AccompanimentSongsDeps, type SectionKey, type SongSection } from './useAccompanimentSongs';
import './free.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

interface Props {
  /** 지금 반주로 고른 곡 id. 다시 누르면 처음부터 다시 틀지 않고 창만 닫는다 */
  currentSongId: number | null;
  /** 지금 곡이 재생 중인지. 참이면 지금 곡 행의 이퀄라이저가 움직이고 거짓이면 멈춘 점이다 */
  currentPlaying?: boolean;
  onPick: (song: AccompanimentPick) => void;
  onClose: () => void;
  /** 테스트용 목록 API 주입 */
  songsDeps?: AccompanimentSongsDeps;
}

const TITLES: Record<SectionKey, string> = { builtin: '공용 곡', mine: '내 곡' };

interface RowProps {
  song: SongSummary;
  current: boolean;
  currentPlaying: boolean;
  /** 시트에서는 「재생 중」 글자 없이 이퀄라이저만 둔다(Figma 803:35396) */
  sheet: boolean;
  onChoose: () => void;
}

function Row({ song, current, currentPlaying, sheet, onChoose }: RowProps) {
  const state = pickableForAccompaniment(song);
  if (state === 'hidden') return null;
  const generating = state === 'generating';
  const cls = ['free-picker-row', generating ? 'is-generating' : '', current ? 'is-current' : ''].filter(Boolean).join(' ');
  return (
    <li>
      <button type="button" className={cls} disabled={generating} onClick={onChoose}>
        <SongCover coverUrl={song.coverUrl} className="free-picker-cover" />
        <span className="free-picker-names">
          <span className="free-picker-title">{song.title}</span>
          <span className="free-picker-artist">{artistLabel(song.artist)}</span>
        </span>
        {generating && <SongStatusBadge status="PROCESSING" label="반주 만드는 중" />}
        {current && (
          <span className="free-picker-now">
            <PlayingEq playing={currentPlaying} />
            {!sheet && '재생 중'}
          </span>
        )}
      </button>
    </li>
  );
}

interface SectionProps {
  name: SectionKey;
  section: SongSection;
  query: string;
  current: number | null;
  currentPlaying: boolean;
  sheet: boolean;
  onChoose: (s: SongSummary) => void;
}

function Section({ name, section, query, current, currentPlaying, sheet, onChoose }: SectionProps) {
  const q = query.trim();
  const count = section.items.length;
  let empty: React.ReactNode = null;
  if (section.status === 'ready' && count === 0) {
    if (q) empty = `‘${q}’에 맞는 곡이 없어요`;
    else if (name === 'builtin') empty = '반주가 있는 공용 곡이 아직 없어요';
    else
      empty = (
        <>
          반주가 있는 내 곡이 없어요. <Link to="/studio">라이브러리</Link>
        </>
      );
  }
  return (
    <section className="free-picker-section" aria-label={TITLES[name]}>
      <h3 className="free-picker-head">
        {TITLES[name]} <span className="free-picker-count num">{count}</span>
      </h3>
      {count > 0 && (
        <ul className="free-picker-list">
          {section.items.map((song) => (
            <Row key={song.id} song={song} current={song.id === current} currentPlaying={currentPlaying} sheet={sheet} onChoose={() => onChoose(song)} />
          ))}
        </ul>
      )}
      {section.status === 'loading' && <p className="free-picker-note">불러오는 중…</p>}
      {empty && <p className="free-picker-note">{empty}</p>}
      {section.status === 'error' && (
        <InlineError plain className="free-picker-note" onRetry={section.retry}>
          목록을 불러오지 못했어요
        </InlineError>
      )}
      {section.status === 'ready' && section.hasMore && (
        <Button variant="secondary" size="sm" className="free-picker-more" onClick={section.loadMore}>
          더 보기
        </Button>
      )}
    </section>
  );
}

export function AccompanimentPicker({ currentSongId, currentPlaying = false, onPick, onClose, songsDeps }: Props) {
  const sheet = useMediaQuery(MOBILE_QUERY);
  const { query, setQuery, sections } = useAccompanimentSongs(songsDeps);
  const inputRef = useRef<HTMLInputElement>(null);

  const choose = (song: SongSummary) => {
    if (song.id === currentSongId) {
      onClose();
      return;
    }
    onPick({ songId: song.id, title: song.title, artist: song.artist || null, coverUrl: song.coverUrl });
  };

  return (
    <Dialog onClose={onClose} labelledBy="free-picker-title" initialFocusRef={inputRef} className={sheet ? 'free-picker is-sheet' : 'free-picker'}>
      {sheet && <span className="free-picker-grab" aria-hidden="true" />}
      <div className="free-picker-top">
        <h2 id="free-picker-title">반주 고르기</h2>
        <IconButton size="sm" label="닫기" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <Input
        ref={inputRef}
        compact
        type="search"
        label="반주 검색"
        placeholder="제목·아티스트 검색"
        value={query}
        maxLength={100}
        onChange={(e) => setQuery(e.target.value)}
        trailing={
          query ? (
            <IconButton size="sm" label="검색어 지우기" onClick={() => setQuery('')}>
              <CloseIcon />
            </IconButton>
          ) : null
        }
      />
      <div className="free-picker-body">
        <Section name="builtin" section={sections.builtin} query={query} current={currentSongId} currentPlaying={currentPlaying} sheet={sheet} onChoose={choose} />
        <Section name="mine" section={sections.mine} query={query} current={currentSongId} currentPlaying={currentPlaying} sheet={sheet} onChoose={choose} />
      </div>
    </Dialog>
  );
}
