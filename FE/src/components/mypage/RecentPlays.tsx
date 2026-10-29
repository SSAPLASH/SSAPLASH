// 마이페이지 "최근 플레이". 로컬 로그(계정별)를 호출자가 넘기고, 여기서는 결과 화면 링크만 만든다.
// 곡이 삭제된 기록은 제목 옆에 "삭제된 곡"을 붙인다(CHART-001 U7·U9). 기록과 결과는 그대로 열린다.
import { Link } from 'react-router-dom';
import { DELETED_SONG_LABEL } from '@/domain/songAvailability';

export interface RecentPlayItem {
  playId: string;
  title: string;
  mode: 'RHYTHM' | 'FREE' | 'SHEET';
  difficulty: string;
  startedAt: string;
  /** 0~1 */
  accuracy: number;
  /** 곡 상세가 404(삭제)로 확인된 기록 */
  deleted?: boolean;
}

const MODE_LABEL: Record<RecentPlayItem['mode'], string> = {
  RHYTHM: '리듬 게임',
  SHEET: '악보 연습',
  FREE: '자유 연주',
};

function whenOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function RecentPlays({ items }: { items: RecentPlayItem[] }) {
  if (items.length === 0) {
    return (
      <p className="dim small">
        아직 플레이 기록이 없습니다. <Link to="/play">곡을 골라</Link> 연주해 보세요.
      </p>
    );
  }
  return (
    <ul className="my-list">
      {items.map((p) => (
        <li key={p.playId}>
          <Link className="my-list-row" to={`/result/${p.playId}`}>
            <span className="my-list-main">
              <span className="my-list-title-row">
                <span className="my-list-title">{p.title}</span>
                {p.deleted && <span className="deleted-song-badge">{DELETED_SONG_LABEL}</span>}
              </span>
              <span className="faint small">
                {[MODE_LABEL[p.mode] ?? p.mode, p.difficulty, whenOf(p.startedAt)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="my-list-num">{`${(p.accuracy * 100).toFixed(1)}%`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
