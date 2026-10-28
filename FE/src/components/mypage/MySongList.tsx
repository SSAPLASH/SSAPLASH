// 마이페이지 "내 곡" 목록. 데이터 로드는 호출자(MyPage)가 하고, 여기서는 상태별 표시·이동만 한다.
import { Link } from 'react-router-dom';
import { songStatusView, type SongSummary } from '@/domain/songCatalog';

interface Props {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: SongSummary[];
  error: string | null;
  onRetry: () => void;
}

/** 완료 곡은 플레이로, 생성 중인 곡은 진행 카드가 있는 곡 작업실로 보낸다. 실패 곡은 이동하지 않는다 */
function linkOf(song: SongSummary): string | null {
  if (song.status === 'READY') return '/play?scope=MINE';
  if (song.status === 'PROCESSING') return '/studio';
  return null;
}

function dateOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR');
}

export function MySongList({ status, items, error, onRetry }: Props) {
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
        <span className="spinner" aria-label="불러오는 중" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="notice error col" role="alert">
        <span>{error ?? '내 곡을 불러오지 못했습니다.'}</span>
        <button type="button" className="btn-ghost" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="dim small">
        아직 만든 곡이 없습니다. <Link to="/studio">곡 만들기</Link>에서 음원을 올리면 채보가 만들어집니다.
      </p>
    );
  }
  return (
    <ul className="my-list">
      {items.map((song) => {
        const view = songStatusView(song.status);
        const to = linkOf(song);
        const body = (
          <>
            <span className="my-list-main">
              <span className="my-list-title">{song.title}</span>
              <span className="faint small">
                {[song.artist, dateOf(song.createdAt)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={`my-badge ${view.tone}`}>{view.label}</span>
          </>
        );
        return (
          <li key={song.id}>
            {to ? (
              <Link className="my-list-row" to={to}>
                {body}
              </Link>
            ) : (
              <div className="my-list-row">{body}</div>
            )}
            {song.status === 'FAILED' && <p className="faint small my-list-note">채보를 만들지 못했습니다. 음원을 다시 올려 주세요.</p>}
          </li>
        );
      })}
    </ul>
  );
}
