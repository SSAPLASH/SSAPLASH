// 연주 기록 (Figma 연주 기록 112:1351, 설계 U16 = 로컬 로그). 이 브라우저에 저장된 최근 20건을 모드 필터·10행 페이지로 보여 준다.
// 삭제된 곡 판정은 components/song/useDeletedSongIds가 맡고, 이 페이지는 조립과 상태(필터·페이지)만 가진다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryTable } from '@/components/history/HistoryTable';
import '@/components/history/history.css';
import { useShell } from '@/components/shell/useShell';
import { useDeletedSongIds } from '@/components/song/useDeletedSongIds';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyle';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { filterPlayLogs, HISTORY_PAGE_SIZE, pageInfo, type HistoryFilter } from '@/domain/playLogView';
import { loadPlayLogs } from '@/engine/playLog';

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'RHYTHM', label: '게임' },
  { value: 'SHEET', label: '악보' },
];

export function HistoryPage() {
  useShell({ title: '연주 기록' });
  const logs = useMemo(() => loadPlayLogs(), []);
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [rawPage, setRawPage] = useState(0);

  const filtered = useMemo(() => filterPlayLogs(logs, filter), [logs, filter]);
  const info = pageInfo(filtered.length, rawPage);
  const rows = filtered.slice(info.page * HISTORY_PAGE_SIZE, (info.page + 1) * HISTORY_PAGE_SIZE);
  const deletedIds = useDeletedSongIds(logs);

  if (logs.length === 0) {
    return (
      <main className="main">
        <EmptyState
          title="아직 연주 기록이 없어요"
          description="곡을 골라 연주하면 여기에 쌓여요."
          action={
            <Link to="/play" className={buttonClassName({ variant: 'primary', size: 'md' })}>
              리듬 게임 시작
            </Link>
          }
        />
      </main>
    );
  }

  const pick = (value: HistoryFilter) => {
    setFilter(value);
    setRawPage(0);
  };

  return (
    <main className="main">
      <div className="history-page">
        <header className="history-head">
          <h1 className="history-title">나의 연주 기록</h1>
          <p className="history-sub">지난 연주를 돌아보고 리듬의 변화를 확인하세요.</p>
        </header>

        <div className="history-toolbar">
          <p className="history-count">전체 기록 {filtered.length}개</p>
          <div className="history-filters" role="group" aria-label="모드 필터">
            {FILTERS.map((f) => (
              <Chip key={f.value} selected={filter === f.value} onClick={() => pick(f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="history-filter-empty">이 모드의 기록이 없어요</p>
        ) : (
          <>
            <HistoryTable logs={rows} deletedIds={deletedIds} />
            <div className="history-pager">
              <p className="history-range">
                {info.from}–{info.to} / {filtered.length}개
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
      </div>
    </main>
  );
}
