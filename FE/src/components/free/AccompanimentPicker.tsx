// 반주 선택 창 (설계 MODE-002 3-12, D6·D7). 공용 곡·내 곡 섹션, 처음부터 검색, 섹션별 더 보기. 재생은 모른다.
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { pickableForAccompaniment, type AccompanimentPick } from '@/domain/freeAccompaniment';
import { artistLabel, type SongSummary } from '@/domain/songCatalog';
import { useAccompanimentSongs, type AccompanimentSongsDeps, type SectionKey, type SongSection } from './useAccompanimentSongs';
import './free.css';

interface Props {
  /** 지금 반주로 고른 곡 id. 다시 누르면 처음부터 다시 틀지 않고 창만 닫는다 */
  currentSongId: number | null;
  onPick: (song: AccompanimentPick) => void;
  onClose: () => void;
  /** 테스트용 목록 API 주입 */
  songsDeps?: AccompanimentSongsDeps;
}

const TITLES: Record<SectionKey, string> = { builtin: '공용 곡', mine: '내 곡' };

function Row({ song, current, onChoose }: { song: SongSummary; current: boolean; onChoose: () => void }) {
  const state = pickableForAccompaniment(song);
  if (state === 'hidden') return null;
  const generating = state === 'generating';
  return (
    <li>
      <button type="button" className={`free-picker-row${generating ? ' is-generating' : ''}`} disabled={generating} onClick={onChoose}>
        {song.coverUrl ? <img className="free-picker-cover" src={song.coverUrl} alt="" /> : <span className="free-picker-cover is-empty" aria-hidden="true" />}
        <span className="free-picker-names">
          <span className="free-picker-title">{song.title}</span>
          <span className="free-picker-artist">{artistLabel(song.artist)}</span>
        </span>
        {generating && <span className="free-picker-state">반주 만드는 중</span>}
        {current && <span className="free-picker-state is-current">재생 중</span>}
      </button>
    </li>
  );
}

function Section({ name, section, query, current, onChoose }: { name: SectionKey; section: SongSection; query: string; current: number | null; onChoose: (s: SongSummary) => void }) {
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
            <Row key={song.id} song={song} current={song.id === current} onChoose={() => onChoose(song)} />
          ))}
        </ul>
      )}
      {section.status === 'loading' && <p className="free-picker-note">불러오는 중…</p>}
      {empty && <p className="free-picker-note">{empty}</p>}
      {section.status === 'error' && (
        <p className="free-picker-note is-error" role="alert">
          목록을 불러오지 못했어요{' '}
          <Button variant="text" size="sm" onClick={section.retry}>
            다시 시도
          </Button>
        </p>
      )}
      {section.status === 'ready' && section.hasMore && (
        <Button variant="secondary" size="sm" onClick={section.loadMore}>
          더 보기
        </Button>
      )}
    </section>
  );
}

export function AccompanimentPicker({ currentSongId, onPick, onClose, songsDeps }: Props) {
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
    <Dialog onClose={onClose} labelledBy="free-picker-title" initialFocusRef={inputRef} className="free-picker">
      <div className="free-picker-top">
        <h2 id="free-picker-title">반주 고르기</h2>
        <Button variant="text" size="sm" onClick={onClose} aria-label="닫기">
          닫기
        </Button>
      </div>
      <div className="free-picker-search">
        <input
          ref={inputRef}
          type="search"
          className="free-picker-input"
          placeholder="제목·아티스트 검색"
          aria-label="반주 검색"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <Button variant="text" size="sm" onClick={() => setQuery('')} aria-label="검색어 지우기">
            지우기
          </Button>
        )}
      </div>
      <div className="free-picker-body">
        <Section name="builtin" section={sections.builtin} query={query} current={currentSongId} onChoose={choose} />
        <Section name="mine" section={sections.mine} query={query} current={currentSongId} onChoose={choose} />
      </div>
    </Dialog>
  );
}
