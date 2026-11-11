// 서버 기록과 이 기기에만 남은 기록을 합쳐 필터·검색·정렬·10행 페이지를 적용한다.
// 로컬 기록의 곡 삭제 판정은 useDeletedSongIds, 서버 기록은 목록의 접근 가능 여부를 쓴다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlaySummary } from '@/api/plays';
import { playListQuery } from '@/api/queries/plays';
import { useApiQuery } from '@/app/useApiQuery';
import { HistoryTable, type HistoryServerRow } from '@/components/history/HistoryTable';
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
import { useAuth } from '@/store/authStore';

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
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  // 서버 기록은 서버 데이터 캐시로 읽는다(설계 TECH-351). 사용자가 바뀌면 캐시가 비워진다(app/queryAuthBinding)
  const server = useApiQuery({ ...playListQuery(userId ?? 0), enabled: status === 'authenticated' && userId != null });
  const localLogs = useMemo(() => status === 'anonymous' || (status === 'authenticated' && userId != null) ? loadPlayLogs() : [], [status, userId]);
  // 읽기 전이면 null, 실패면 plays null (기존 표시 규칙 유지)
  const serverPlays = server.data;
  const current: { plays: PlaySummary[] | null } | null = useMemo(
    () => (server.status === 'ready' ? { plays: serverPlays ?? [] } : server.status === 'error' ? { plays: null } : null),
    [server.status, serverPlays],
  );
  const logs = useMemo(() => {
    const plays = current?.plays ?? [];
    const ids = new Set(plays.map((p) => p.playId));
    const localIds = new Set(localLogs.map((log) => log.playId));
    const server: HistoryServerRow[] = plays.map((play) => ({
      source: 'server', play, playId: play.playId,
      title: play.songTitle ?? '제목 없는 연주',
      mode: play.mode, difficulty: play.difficulty ?? '', startedAt: play.startedAt, hasLocal: localIds.has(play.playId),
    }));
    return [...server, ...localLogs.filter((log) => !ids.has(log.playId))];
  }, [current, localLogs]);
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
  const deletedIds = useDeletedSongIds(localLogs);

  if (status === 'unknown' || status === 'restoring' || (status === 'authenticated' && (!userId || !current))) {
    return <p role="status">연주 기록을 불러오는 중…</p>;
  }

  const error = status === 'authenticated' && current?.plays === null;
  const errorNotice = error ? <div role="alert">서버 기록을 불러오지 못했어요. <button onClick={server.refetch}>다시 시도</button></div> : null;

  if (logs.length === 0) {
    if (error) return errorNotice;
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
      {errorNotice}
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
