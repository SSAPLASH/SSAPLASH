// 연주 기록 화면의 [플레이 기록] 탭 본문(Figma 연주 기록 112:1351). 이 브라우저에 저장된 최근 20건을
// 모드 필터 → 곡 제목 검색 → 정렬 → 10행 페이지 순서로 보여 준다. 검색은 로컬이라 디바운스 없이 즉시 적용한다(설계 U12).
// 삭제된 곡 판정은 components/song/useDeletedSongIds가 맡고, 이 컴포넌트는 조립과 상태(필터·검색·정렬·페이지)만 가진다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryTable } from '@/components/history/HistoryTable';
import '@/components/history/history.css';
import { useDeletedSongIds } from '@/components/song/useDeletedSongIds';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyle';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Segmented';
import {
  filterPlayLogs,
  HISTORY_PAGE_SIZE,
  pageInfo,
  searchPlayLogs,
  sortPlayLogs,
  type HistoryFilter,
  type PlayLogSort,
} from '@/domain/playLogView';
import { loadPlayLogs } from '@/engine/playLog';

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'RHYTHM', label: '게임' },
  { value: 'SHEET', label: '악보' },
];

const SORTS: { value: PlayLogSort; label: string }[] = [
  { value: 'NEWEST', label: '최신' },
  { value: 'OLDEST', label: '오래된' },
];

/** 처음 상태. 서버 렌더 테스트에서 검색·정렬 결과를 확인하려고 둔 시작값이며 화면에서는 쓰지 않는다 */
export interface PlayLogTabProps {
  initialQuery?: string;
  initialSort?: PlayLogSort;
}

export function PlayLogTab({ initialQuery = '', initialSort = 'NEWEST' }: PlayLogTabProps = {}) {
  const logs = useMemo(() => loadPlayLogs(), []);
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState<PlayLogSort>(initialSort);
  const [rawPage, setRawPage] = useState(0);

  const visible = useMemo(
    () => sortPlayLogs(searchPlayLogs(filterPlayLogs(logs, filter), q), sort),
    [logs, filter, q, sort],
  );
  const info = pageInfo(visible.length, rawPage);
  const rows = visible.slice(info.page * HISTORY_PAGE_SIZE, (info.page + 1) * HISTORY_PAGE_SIZE);
  const deletedIds = useDeletedSongIds(logs);

  if (logs.length === 0) {
    return (
      <EmptyState
        title="아직 연주 기록이 없어요"
        description="곡을 골라 연주하면 여기에 쌓여요."
        action={
          <Link to="/play" className={buttonClassName({ variant: 'primary', size: 'md' })}>
            리듬 게임 시작
          </Link>
        }
      />
    );
  }

  // 조건이 바뀌면 첫 쪽부터 다시 본다
  const pickFilter = (value: HistoryFilter) => {
    setFilter(value);
    setRawPage(0);
  };
  const changeQuery = (value: string) => {
    setQ(value);
    setRawPage(0);
  };
  const pickSort = (value: PlayLogSort) => {
    setSort(value);
    setRawPage(0);
  };

  return (
    <>
      <div className="history-toolbar">
        <p className="history-count">전체 기록 {visible.length}개</p>
        <div className="history-tools">
          <Segmented options={FILTERS} value={filter} onChange={pickFilter} label="모드 필터" />
          <Input
            compact
            className="history-search"
            label="곡 제목 검색"
            placeholder="곡 제목 검색"
            type="search"
            value={q}
            onChange={(e) => changeQuery(e.target.value)}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="history-filter-empty">조건에 맞는 기록이 없어요</p>
      ) : (
        <>
          <HistoryTable
            logs={rows}
            deletedIds={deletedIds}
            sortSlot={<Segmented options={SORTS} value={sort} onChange={pickSort} label="정렬" />}
          />
          <div className="history-pager">
            <p className="history-range">
              {info.from}–{info.to} / {visible.length}개
            </p>
            <nav className="history-pager-nav" aria-label="페이지 이동">
              <Button variant="text" size="sm" disabled={info.page === 0} onClick={() => setRawPage(info.page - 1)}>
                이전
              </Button>
              {Array.from({ length: info.pageCount }, (_, i) => (
                <Button
                  key={i}
                  variant="text"
                  size="sm"
                  className="history-page-no"
                  aria-current={i === info.page ? 'page' : undefined}
                  onClick={() => setRawPage(i)}
                >
                  {i + 1}
                </Button>
              ))}
              <Button variant="text" size="sm" disabled={info.page >= info.pageCount - 1} onClick={() => setRawPage(info.page + 1)}>
                다음
              </Button>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
