// 플레이 기록 탭 (설계 COACH-연주-기록-화면-개편). 서버 기록을 쪽 단위로 받아 날짜별로 묶어 보인다.
// 검색·모드·기간·정렬은 서버가 처리하고(usePlayLogList), 아직 서버에 없는 이 브라우저의 기록은 같은 조건을 화면에서 적용해 시각 순서로 섞는다.
// 그런 기록은 행 오른쪽에 저장 상태로 구분한다. 로그인 없는 빌드는 서버 없이 이 브라우저의 기록만 보인다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayLogRow } from './PlayLogRow';
import { localRowView, serverRowView, type PlayRowView } from './playLogRows';
import { usePlayLogList } from './usePlayLogList';
import './history.css';
import { useDeletedSongIds } from '@/components/song/useDeletedSongIds';
import { Button } from '@/components/ui/action/Button';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { ErrorState } from '@/components/ui/feedback/ErrorState';
import { InlineError } from '@/components/ui/feedback/InlineError';
import { Input } from '@/components/ui/form/Input';
import { Segmented } from '@/components/ui/form/Segmented';
import {
  filterPlayLogs,
  groupByDay,
  inPeriod,
  mergeUnsaved,
  periodRange,
  searchPlayLogs,
  unsavedLogs,
  type HistoryFilter,
  type HistoryPeriod,
  type PlayLogSort,
} from '@/domain/play/playLogView';
import { loadPlayLogs } from '@/engine/playLog';
import { startPlaySync, usePlaySync } from '@/runtime/playSync';
import { useAuth } from '@/store/authStore';

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'RHYTHM', label: '리듬 게임' },
  { value: 'SHEET', label: '악보 연습' },
];

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: 'ALL', label: '전체 기간' },
  { value: '7D', label: '7일' },
  { value: '30D', label: '30일' },
];

const SORTS: { value: PlayLogSort; label: string }[] = [
  { value: 'NEWEST', label: '최신' },
  { value: 'OLDEST', label: '오래된' },
];

const rowTime = (row: PlayRowView) => row.at;

export function PlayLogTab() {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  const authed = status === 'authenticated' && userId != null;
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [period, setPeriod] = useState<HistoryPeriod>('ALL');
  const [sort, setSort] = useState<PlayLogSort>('NEWEST');
  const [q, setQ] = useState('');
  // 날짜 묶음(오늘·어제)과 기간 계산의 기준 시각. 조건을 바꿀 때마다 새로 잡아, 화면을 켜 둔 채 자정을 넘겨도 맞게 한다
  const [now, setNow] = useState(() => new Date());
  /** 조건을 바꾸는 조작에 기준 시각 갱신을 붙인다 */
  const fresh = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setNow(new Date());
  };

  const list = usePlayLogList(authed ? userId : null, { mode: filter, period, sort, q }, now);
  // 이 브라우저의 로그(계정별 저장이라 계정이 바뀌면 다시 읽는다). 로그인 없는 빌드는 공용 키의 로그다
  const localLogs = useMemo(() => (status === 'anonymous' || (status === 'authenticated' && userId != null) ? loadPlayLogs() : []), [status, userId]);
  const live = usePlaySync((s) => s.states);
  const deletedIds = useDeletedSongIds(localLogs);

  // 올리다 끊긴 기록(창을 닫아 UPLOADING으로 남은 것)은 들어올 때 다시 보낸다. 진행 중이면 startPlaySync가 그 요청을 그대로 돌려준다
  useEffect(() => {
    if (!authed) return;
    for (const log of localLogs) if (log.upload?.status === 'UPLOADING') void startPlaySync(log.playId);
  }, [authed, localLogs]);

  const rows = useMemo(() => {
    const serverIds = new Set(list.items.map((p) => p.playId));
    const localById = new Map(localLogs.map((l) => [l.playId, l]));
    const server = list.items.map((p) => serverRowView(p, localById.has(p.playId), localById.get(p.playId)));
    // 로그인 없는 빌드는 서버가 없으므로 이 브라우저의 로그가 전부다
    const pending = authed ? unsavedLogs(localLogs, serverIds, live) : localLogs;
    const range = periodRange(period, now);
    const local = searchPlayLogs(filterPlayLogs(pending, filter), list.appliedQ)
      .map((log) => localRowView(log, { deleted: log.songNumericId != null && deletedIds.has(log.songNumericId), upload: live[log.playId] ?? log.upload, showSave: authed }))
      .filter((row) => inPeriod(row.at, range));
    return {
      merged: mergeUnsaved(server, local, { sort, hasNext: list.hasNext, serverTime: rowTime, localTime: rowTime }),
      total: list.total + local.length,
    };
  }, [list.items, list.total, list.hasNext, list.appliedQ, localLogs, live, deletedIds, authed, filter, period, sort, now]);

  if (status === 'unknown' || status === 'restoring' || (status === 'authenticated' && userId == null)) {
    return <p role="status">연주 기록을 불러오는 중…</p>;
  }

  const plain = filter === 'ALL' && period === 'ALL' && q.trim() === '' && list.appliedQ.trim() === '';
  const clear = () => {
    setFilter('ALL');
    setPeriod('ALL');
    setQ('');
    setNow(new Date());
  };

  // 처음 읽는 동안, 그리고 조건 없이 아무 기록도 없을 때는 도구 줄 없이 상태만 보인다
  if (plain && rows.merged.length === 0) {
    if (list.loading) return <p role="status">연주 기록을 불러오는 중…</p>;
    if (list.error) return <ErrorState size="lg" title="연주 기록을 불러오지 못했어요" description="네트워크를 확인하고 다시 시도해 주세요." onRetry={list.reload} />;
    return (
      <EmptyState
        title="아직 연주 기록이 없어요"
        description="곡을 골라 연주하면 여기에 날짜별로 쌓여요."
        action={
          <Link to="/play" className={buttonClassName({ variant: 'primary', size: 'md' })}>
            리듬 게임 시작
          </Link>
        }
      />
    );
  }

  const groups = groupByDay(rows.merged, rowTime, now);
  const retry = (playId: string) => void startPlaySync(playId);

  return (
    <>
      <div className="history-toolbar">
        {/* 서버가 100자를 넘는 검색어를 400으로 거부한다(BE 309) */}
        <Input compact className="history-search" label="곡 제목 검색" placeholder="곡 제목 검색" type="search" maxLength={100} value={q} onChange={(e) => fresh(setQ)(e.target.value)} />
        <Segmented options={FILTERS} value={filter} onChange={fresh(setFilter)} label="모드 필터" />
        <Segmented options={PERIODS} value={period} onChange={fresh(setPeriod)} label="기간" />
        <Segmented className="history-toolbar-end" options={SORTS} value={sort} onChange={fresh(setSort)} label="정렬" />
      </div>

      <p className="history-count">
        <strong>{rows.total}</strong>개 기록
      </p>

      {list.error ? (
        <InlineError size="md" onRetry={list.reload}>
          서버 기록을 불러오지 못했어요.
        </InlineError>
      ) : null}

      {rows.merged.length === 0 ? (
        list.loading ? (
          <p className="history-filter-empty" role="status">
            불러오는 중…
          </p>
        ) : list.error ? null : (
          <EmptyState
            size="sm"
            title="조건에 맞는 기록이 없어요"
            description="검색어나 기간을 바꿔 보세요."
            action={
              <Button variant="text" size="sm" onClick={clear}>
                조건 지우기
              </Button>
            }
          />
        )
      ) : (
        <div className="history-groups">
          {groups.map((group) => (
            <section key={group.key} className="history-group" aria-label={group.label}>
              <div className="history-group-head">
                <h2>{group.label}</h2>
                <span>{group.items.length}판</span>
              </div>
              <ul className="history-list">
                {group.items.map((row) => (
                  <PlayLogRow key={row.playId} row={row} onRetry={retry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {list.hasNext ? (
        <div className="history-more">
          <Button variant="secondary" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? '불러오는 중…' : '더 보기'}
            <span className="history-more-count">
              {rows.merged.length}/{rows.total}
            </span>
          </Button>
        </div>
      ) : null}
    </>
  );
}
