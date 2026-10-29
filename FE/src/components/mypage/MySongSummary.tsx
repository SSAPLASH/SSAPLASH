// 마이페이지 "내 곡" 요약. 곡 개수·상태별 개수 한 줄과 내 곡 관리 링크만 보인다. 데이터 로드는 호출자(MyPage)가 한다.
import { Link } from 'react-router-dom';
import { summarizeMineSongs, type SongSummary } from '@/domain/songCatalog';

interface Props {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: SongSummary[];
  error: string | null;
  onRetry: () => void;
}

export function MySongSummary({ status, items, error, onRetry }: Props) {
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
        <span>{error ?? '라이브러리를 불러오지 못했습니다.'}</span>
        <button type="button" className="btn-ghost" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }
  const sum = summarizeMineSongs(items);
  if (sum.total === 0) {
    return (
      <p className="dim small">
        아직 만든 곡이 없습니다. <Link to="/studio">라이브러리</Link>에서 음원을 올리면 채보가 만들어집니다.
      </p>
    );
  }
  // 0인 항목은 생략한다
  const parts = [`곡 ${sum.total}개`];
  if (sum.ready > 0) parts.push(`완료 ${sum.ready}`);
  if (sum.processing > 0) parts.push(`생성 중 ${sum.processing}`);
  if (sum.failed > 0) parts.push(`실패 ${sum.failed}`);
  return (
    <p className="small">
      {parts.join(' · ')} · <Link to="/studio">라이브러리</Link>
    </p>
  );
}
