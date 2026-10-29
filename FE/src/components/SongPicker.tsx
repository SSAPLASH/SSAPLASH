// 곡 선택 (설계 2). 탭(기본 제공 곡 / 내 곡) · 검색(300ms 디바운스) · 곡 카드 → 펼치면 난이도 칩 → onSelect(songId, chartId).
// /play·/sheet가 같이 쓴다. 선택 결과는 페이지가 URL로 옮긴다.
// mode="sheet"는 Claude Design Select 보드의 표 모양(열 헤더·행·펼친 난이도 칩, .sheet-mode 스코프 클래스)으로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DIFFICULTY_LABEL,
  isPlayableStatus,
  songStatusView,
  type SongDetail,
  type SongScope,
  type SongSummary,
} from '@/domain/songCatalog';
import { formatDuration } from '@/components/formatTime';
import { formatAccuracy, latestSheetLog, loadPlayLogs } from '@/engine/playLog';
import { useSongs } from '@/store/songStore';

interface Props {
  onSelect: (songId: number, chartId: number) => void;
  mode: 'play' | 'sheet';
}

const SEARCH_DEBOUNCE_MS = 300;

function mmss(ms: number | null): string {
  return ms === null ? '–' : formatDuration(ms);
}

/** 내 곡 탭에서 완료되지 않은 곡은 고를 수 없다 */
function isLocked(tab: SongScope, song: SongSummary): boolean {
  return tab === 'MINE' && !isPlayableStatus(song.status);
}

type DetailState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: SongDetail };

export function SongPicker({ onSelect, mode }: Props) {
  const { source, scope, items, status, error, load, selectSong } = useSongs();
  // `?scope=MINE`로 열면 내 곡 탭에서 시작한다(곡 작업실 완료 → 플레이 진입)
  const [params] = useSearchParams();
  const [tab, setTab] = useState<SongScope>(params.get('scope') === 'MINE' ? 'MINE' : scope);
  const [query, setQuery] = useState('');
  // undefined: 사용자가 아직 펼침·접기를 하지 않았다(이때는 `?song=` 딥링크 곡이 펼쳐진다)
  const [manualOpenId, setOpenId] = useState<number | null | undefined>(undefined);
  const [details, setDetails] = useState<Record<number, DetailState>>({});
  // 최근 정확도 열: 마운트 시점의 로컬 악보 연주 로그(최신순)
  const logs = useMemo(() => (mode === 'sheet' ? loadPlayLogs() : []), [mode]);
  const queryRef = useRef(query);
  const firstLoad = useRef(true);

  // 탭·검색어가 바뀌면 목록을 다시 읽는다. 첫 로드는 즉시, 검색어 변경은 디바운스
  useEffect(() => {
    const delay = firstLoad.current || queryRef.current === query ? 0 : SEARCH_DEBOUNCE_MS;
    firstLoad.current = false;
    queryRef.current = query;
    const t = setTimeout(() => void load(tab, query), delay);
    return () => clearTimeout(t);
  }, [tab, query, load]);

  const fetchDetail = useCallback(
    (id: number) => {
      setDetails((d) => ({ ...d, [id]: { status: 'loading' } }));
      selectSong(id).then(
        (detail) => setDetails((d) => ({ ...d, [id]: { status: 'ready', detail } })),
        (e: unknown) =>
          setDetails((d) => ({ ...d, [id]: { status: 'error', message: e instanceof Error ? e.message : '곡 정보를 불러오지 못했습니다.' } })),
      );
    },
    [selectSong],
  );

  // `?song={id}`: 내 곡 탭의 목록에 그 곡이 있고 완료 상태면 펼친 채로 연다. 상세 조회는 한 번만 한다
  const deepLinkId = useMemo(() => {
    const n = Number(params.get('song'));
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [params]);
  const deepTarget =
    deepLinkId !== null && tab === 'MINE' && status === 'ready' && scope === 'MINE'
      ? items.find((s) => s.id === deepLinkId && isPlayableStatus(s.status))
      : undefined;
  const openId = manualOpenId !== undefined ? manualOpenId : (deepTarget?.id ?? null);
  const deepFetched = useRef(false);
  const deepTargetId = deepTarget?.id;
  useEffect(() => {
    if (deepFetched.current || deepTargetId === undefined) return;
    deepFetched.current = true;
    fetchDetail(deepTargetId);
  }, [deepTargetId, fetchDetail]);

  const toggle = (song: SongSummary) => {
    if (isLocked(tab, song)) return;
    if (openId === song.id) {
      setOpenId(null);
      return;
    }
    setOpenId(song.id);
    if (details[song.id]?.status !== 'ready') fetchDetail(song.id);
  };

  const hasUnplayable = tab === 'MINE' && items.some((s) => !isPlayableStatus(s.status));
  const unplayableNote = hasUnplayable ? (
    <p className="small dim">
      처리 중·실패한 곡은 <Link to="/studio">라이브러리</Link>에서 확인하세요.
    </p>
  ) : null;

  if (mode === 'sheet') {
    return (
      <>
        <div className="sm-toolbar">
          {source === 'api' &&
            (['BUILTIN', 'MINE'] as const).map((sc) => (
              <button key={sc} role="tab" aria-selected={tab === sc} className="sm-tab" onClick={() => setTab(sc)}>
                {sc === 'BUILTIN' ? '기본 제공 곡' : '라이브러리'}
              </button>
            ))}
          <label className="sm-search">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13 13l4 4" />
            </svg>
            <input
              type="text"
              value={query}
              placeholder="제목·아티스트 검색"
              aria-label="곡 검색"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {status === 'loading' && (
          <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
            <span className="spinner" aria-label="불러오는 중" />
          </div>
        )}
        {status === 'error' && (
          <div className="notice error col" role="alert">
            <span>{error ?? '곡 목록을 불러오지 못했습니다.'}</span>
            <button className="sm-btn" onClick={() => void load(tab, query)}>
              다시 시도
            </button>
          </div>
        )}
        {status === 'ready' && items.length === 0 && (
          <p className="sm-hint">
            {tab === 'MINE' ? (
              <>
                아직 만든 곡이 없습니다. <Link to="/studio">라이브러리</Link>에서 음원을 올려 보세요.
              </>
            ) : (
              '곡이 없습니다'
            )}
          </p>
        )}

        {status === 'ready' && items.length > 0 && (
          <>
            <div className="sm-song-head">
              <span>곡</span>
              <span>BPM</span>
              <span>길이</span>
              <span>최근 정확도</span>
            </div>
            <div className="sm-song-list">
              {items.map((song) => {
                const d = details[song.id];
                const open = openId === song.id;
                const last = latestSheetLog(logs, { songNumericId: song.id });
                const pct = last ? last.summary.accuracy * 100 : null;
                const locked = isLocked(tab, song);
                const view = songStatusView(song.status);
                const tone = pct === null ? undefined : pct >= 80 ? 'var(--sm-perfect)' : pct >= 60 ? 'var(--sm-good)' : 'var(--sm-miss)';
                return (
                  <div key={song.id} className={`sm-song-row${open ? ' selected' : ''}${locked ? ' disabled' : ''}`}>
                    <button
                      className="sm-song-main"
                      aria-expanded={open}
                      disabled={locked}
                      aria-disabled={locked || undefined}
                      onClick={() => toggle(song)}
                    >
                      <span>
                        <span className="sm-song-title">{song.title}</span>
                        {locked && <span className={`my-badge ${view.tone}`}>{view.label}</span>}
                        <span className="sm-song-meta">
                          {song.artist ? `${song.artist} · ` : ''}
                          {tab === 'MINE' ? '라이브러리' : '기본 제공'} · {song.hasAccompaniment ? '반주 있음' : '반주 없음'}
                        </span>
                      </span>
                      <span className="sm-num sm-col-bpm">{song.bpm}</span>
                      <span className="sm-num sm-col-len">{mmss(song.durationMs)}</span>
                      <span className="sm-num" style={{ color: tone ?? 'var(--sm-text-3)', fontWeight: last ? 600 : 400 }}>
                        {last ? formatAccuracy(last.summary.accuracy) : '—'}
                      </span>
                    </button>
                    {open && (
                      <div className="sm-song-diffs">
                        <span className="sm-hint" style={{ marginRight: 4 }}>
                          난이도
                        </span>
                        {(!d || d.status === 'loading') && <span className="spinner" aria-label="불러오는 중" />}
                        {d?.status === 'error' && (
                          <div className="notice error row" role="alert">
                            <span>{d.message}</span>
                            <button className="sm-btn" onClick={() => fetchDetail(song.id)}>
                              다시 시도
                            </button>
                          </div>
                        )}
                        {d?.status === 'ready' && d.detail.charts.length === 0 && <span className="sm-hint">채보가 없습니다</span>}
                        {d?.status === 'ready' &&
                          d.detail.charts.map((c) => (
                            <button key={c.id} className="sm-diff-chip" onClick={() => onSelect(song.id, c.id)}>
                              {DIFFICULTY_LABEL[c.difficulty]} <small>노트 {c.noteCount}</small>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {unplayableNote}
          </>
        )}
      </>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      {source === 'api' && (
        <div className="row" role="tablist" aria-label="곡 범위">
          {(['BUILTIN', 'MINE'] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={tab === s}
              className={tab === s ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setTab(s)}
            >
              {s === 'BUILTIN' ? '기본 제공 곡' : '라이브러리'}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        placeholder="제목·아티스트 검색"
        aria-label="곡 검색"
        onChange={(e) => setQuery(e.target.value)}
      />

      {status === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
          <span className="spinner" aria-label="불러오는 중" />
        </div>
      )}

      {status === 'error' && (
        <div className="notice error col" role="alert">
          <span>{error ?? '곡 목록을 불러오지 못했습니다.'}</span>
          <button className="btn-ghost small" onClick={() => void load(tab, query)}>
            다시 시도
          </button>
        </div>
      )}

      {status === 'ready' && items.length === 0 && (
        <p className="small dim">
          {tab === 'MINE' ? (
            <>
              아직 만든 곡이 없습니다. <Link to="/studio">라이브러리</Link>에서 음원을 올려 보세요.
            </>
          ) : (
            '곡이 없습니다'
          )}
        </p>
      )}

      {status === 'ready' && (
        <div className="chart-list" style={{ maxWidth: 'none' }} data-mode={mode}>
          {items.map((song) => {
            const d = details[song.id];
            const open = openId === song.id;
            const locked = isLocked(tab, song);
            const view = songStatusView(song.status);
            return (
              <div key={song.id} className="col" style={{ gap: 6 }}>
                <button
                  className={`card chart-item${open ? ' active' : ''}${locked ? ' disabled' : ''}`}
                  aria-expanded={open}
                  disabled={locked}
                  aria-disabled={locked || undefined}
                  onClick={() => toggle(song)}
                >
                  <span className="col" style={{ gap: 2 }}>
                    <strong>
                      {song.title}
                      {locked && <span className={`my-badge ${view.tone}`}>{view.label}</span>}
                    </strong>
                    <span className="small dim">
                      {song.artist} · {song.bpm} BPM · {mmss(song.durationMs)}
                    </span>
                  </span>
                  <span className="diff">{song.hasAccompaniment ? '반주 있음' : '반주 없음'}</span>
                </button>
                {open && (
                  <div className="row" style={{ paddingLeft: 8 }}>
                    {(!d || d.status === 'loading') && <span className="spinner" aria-label="불러오는 중" />}
                    {d?.status === 'error' && (
                      <div className="notice error row" role="alert">
                        <span>{d.message}</span>
                        <button className="btn-ghost small" onClick={() => fetchDetail(song.id)}>
                          다시 시도
                        </button>
                      </div>
                    )}
                    {d?.status === 'ready' && d.detail.charts.length === 0 && <span className="small dim">채보가 없습니다</span>}
                    {d?.status === 'ready' && (
                      <div className="chips">
                        {d.detail.charts.map((c) => (
                          <button key={c.id} className="chip" onClick={() => onSelect(song.id, c.id)}>
                            {DIFFICULTY_LABEL[c.difficulty]} · 노트 {c.noteCount}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {status === 'ready' && unplayableNote}
    </div>
  );
}
