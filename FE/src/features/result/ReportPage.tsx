// 연주 상세 리포트 (COACH-002, 설계 COACH-002 4-3 · 화면 구성은 설계 COACH-002 리포트 화면 개편). 서버 리포트만 쓴다 — 로컬 결과 값과 섞지 않는다(D5).
// 화면 순서: 머리말 → 요약 수치 → 코치의 한마디 → 전체 노트 흐름(5초 막대·놓친 구간 버튼) → 선택 구간 확대 → 패드 전환 관찰 → 그 밖의 관찰 → 패드별 기록 → 추천.
// 요약이 오면 바로 그리고, 노트는 페이지를 끝까지 받아 시간순 정렬한 뒤 막대와 확대 영역을 그린다(D8).
// AI 약점은 유형으로 자리를 나누되(놓침이 몰린 구간·패드 전환·그 밖) 문구는 서버 값을 그대로 쓴다.
// 리포트에 songId가 있으면 "방금 친 곡과 비슷한 곡"(설계 COACH-004-similar-songs D4)도 붙는다. 없으면(BE 반영 전) 그리지 않는다.
// 하단 "추천 곡"(설계 COACH-004-song-recommend-report): 리포트가 OK가 된 뒤 playId당 1회만 요청하고, 키 수명(clear)은 바깥 ReportPage가 맡는다.
import { rateLabel, slowRateOf } from '@/domain/song/practiceRate';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getChartAssets } from '@/api/song/charts';
import { audioEngine } from '@/audio/AudioEngine';
import { createAnalysisPoller } from './analysisPoller';
import { loadAllReportNotes, prefetchReport, refreshReport, reportErrorKind } from '@/runtime/playSync';
import { CoachSummaryCard } from '@/features/result/components/report/CoachSummaryCard';
import { FocusPanel } from '@/features/result/components/report/FocusPanel';
import { NoteFlowChart } from '@/features/result/components/report/NoteFlowChart';
import { AnalysisNotice, ObservationList, PadTable, StatsLine, type ObservationRow, type PollingState } from '@/features/result/components/report/ReportSections';
import { TimingHistogram } from '@/features/result/components/report/TimingHistogram';
import { useSegmentPlayer } from '@/features/result/components/report/useSegmentPlayer';
import { RecommendRow } from '@/features/result/components/RecommendRow';
import type { Report, ReportNote, WeakSegment } from '@/domain/play/report';
import { recommendationPathOf } from '@/domain/song/recommendation';
import {
  clockRange,
  flowBins,
  flowTotalMs,
  focusOfBin,
  focusOfCluster,
  focusOfSegment,
  focusOfTransition,
  initialFocus,
  observationText,
  splitSegments,
  transitionWindow,
  type Focus,
} from '@/features/result/domain/reportView';
import { getPlayLog } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';
import { entryOf, useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import '@/features/result/components/report/report.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

type Load<T> = { s: 'loading' } | { s: 'ok'; v: T } | { s: 'error'; e: unknown };

/** PENDING 리포트 재조회 간격·최대 횟수 (COACH-003 3-5) */
const ANALYSIS_POLL_INTERVAL_MS = 2000;
const ANALYSIS_POLL_MAX = 5;

const MODE_LABEL: Record<string, string> = { RHYTHM: '리듬 게임', SHEET: '악보 연습' };
const INPUT_LABEL: Record<string, string> = { KEYBOARD: '키보드', STICK: '스틱' };
const DIFFICULTY_LABEL: Record<string, string> = { EASY: 'EASY', NORMAL: 'NORMAL', HARD: 'HARD' };

/** 오류 → 안내 문구와 다시 시도 가능 여부 (회신 1 §4) */
function describeError(e: unknown): { text: string; retry: boolean; login?: boolean } {
  switch (reportErrorKind(e)) {
    case 'NO_REPORT':
      return { text: '이 기록은 분석 자료가 없습니다.', retry: false };
    case 'NO_PLAY':
      return { text: '기록을 찾을 수 없습니다.', retry: false };
    case 'AUTH':
      return { text: '로그인이 필요합니다.', retry: false, login: true };
    case 'BAD_REQUEST':
      return { text: '잘못된 기록 주소입니다.', retry: false };
    default:
      return { text: '분석을 불러오지 못했습니다.', retry: true };
  }
}

export function ReportPage() {
  const { playId = '' } = useParams();
  const [attempt, setAttempt] = useState(0);
  const clearReco = useRecommendations((r) => r.clear);
  // 비슷한 곡 키(`SIMILAR:${songId}`)는 리포트가 와야 알 수 있어 ReportView가 여기에 등록한다
  const [similarKeys] = useState(() => new Set<string>());
  // 추천 키의 수명은 playId 단위다(D3). 재마운트되는 ReportView가 아니라 여기서 지운다
  useEffect(() => {
    const key = `REPORT:${playId}`;
    return () => {
      clearReco(key);
      clearReco(`DRILL:${playId}`);
      similarKeys.forEach((k) => clearReco(k));
      similarKeys.clear();
    };
  }, [playId, clearReco, similarKeys]);
  // 다시 시도하면 key가 바뀌어 처음 상태(불러오는 중)부터 다시 시작한다
  return <ReportView key={`${playId}:${attempt}`} playId={playId} similarKeys={similarKeys} onRetry={() => setAttempt((a) => a + 1)} />;
}

function ReportView({ playId, similarKeys, onRetry }: { playId: string; similarKeys: Set<string>; onRetry: () => void }) {
  const log = useMemo(() => getPlayLog(playId), [playId]);
  const [report, setReport] = useState<Load<Report>>({ s: 'loading' });
  const [notes, setNotes] = useState<Load<ReportNote[]>>({ s: 'loading' });
  const [polling, setPolling] = useState<PollingState>('idle');
  // 새로고침 버튼이 올리면 재조회를 5회부터 다시 시작한다
  const [pollRun, setPollRun] = useState(0);
  const player = useSegmentPlayer(audioEngine);
  const [accompanimentUrl, setAccompanimentUrl] = useState<string | null>(null);
  const pending = report.s === 'ok' && report.v.analysisStatus === 'PENDING';
  // 지금 확대해서 보는 구간. 사용자가 고르기 전(null)에는 initialFocus가 정한다 — 분석이 늦게 와도 고른 뒤에는 바뀌지 않는다
  const [picked, setPicked] = useState<Focus | null>(null);
  const weakSegments = report.s === 'ok' ? report.v.weakSegments : null;
  const groups = useMemo(() => splitSegments(weakSegments), [weakSegments]);
  const noteList = notes.s === 'ok' ? notes.v : null;
  const totalMs = useMemo(() => flowTotalMs(noteList ?? [], log?.durationMs ?? null), [noteList, log?.durationMs]);
  const bins = useMemo(() => flowBins(noteList ?? [], totalMs), [noteList, totalMs]);

  // 추천: API 곡 소스 + 로그인일 때만, 리포트가 처음 OK가 된 뒤 요청한다(D1·D6). 중복은 store가 막는다(D2)
  const navigate = useNavigate();
  const recoKey = `REPORT:${playId}`;
  const songsSource = useSongs((s) => s.source);
  const authed = useAuth((a) => a.status === 'authenticated');
  const recoEnabled = import.meta.env.VITE_AUTH_REQUIRED !== 'false' && songsSource === 'api' && authed;
  const recoEntry = useRecommendations((r) => entryOf(r.entries, recoKey));
  const loadReco = useRecommendations((r) => r.load);
  const clickReco = useRecommendations((r) => r.click);
  const reportMode = report.s === 'ok' ? report.v.mode : null;
  useEffect(() => {
    if (!recoEnabled || reportMode === null) return;
    void loadReco(recoKey, { context: 'REPORT', mode: reportMode === 'SHEET' ? 'SHEET' : 'RHYTHM', playId, size: 5 });
  }, [recoEnabled, reportMode, recoKey, playId, loadReco]);

  // 약점 연계 연습은 분석 완료 후 별도 노출로 한 번만 조회한다.
  const drillKey = `DRILL:${playId}`;
  const drillEntry = useRecommendations((r) => entryOf(r.entries, drillKey));
  const analysisDone = report.s === 'ok' && report.v.analysisStatus === 'DONE';
  useEffect(() => {
    if (!recoEnabled || !analysisDone || reportMode === null) return;
    void loadReco(drillKey, { context: 'DRILL', mode: reportMode === 'SHEET' ? 'SHEET' : 'RHYTHM', playId, size: 3 });
  }, [recoEnabled, analysisDone, reportMode, drillKey, playId, loadReco]);

  // 비슷한 곡: 리포트 응답에 songId가 있을 때만(없으면 null로 두고 요청·그리기 모두 안 한다)
  const similarSongId = report.s === 'ok' ? report.v.songId : null;
  const similarDifficulty = report.s === 'ok' ? report.v.difficulty : null;
  const similarKey = `SIMILAR:${similarSongId}`;
  const similarEntry = useRecommendations((r) => entryOf(r.entries, similarKey));
  const loadSimilar = useRecommendations((r) => r.loadSimilar);
  useEffect(() => {
    if (!recoEnabled || similarSongId === null) return;
    similarKeys.add(similarKey);
    void loadSimilar(similarKey, { songId: similarSongId, difficulty: similarDifficulty ?? undefined, size: 5 });
  }, [recoEnabled, similarSongId, similarDifficulty, similarKey, similarKeys, loadSimilar]);

  useEffect(() => {
    let alive = true;
    const pf = prefetchReport(playId);
    pf.report.then(
      (v) => alive && setReport({ s: 'ok', v }),
      (e: unknown) => alive && setReport({ s: 'error', e }),
    );
    loadAllReportNotes(playId).then(
      (v) => alive && setNotes({ s: 'ok', v }),
      (e: unknown) => alive && setNotes({ s: 'error', e }),
    );
    return () => {
      alive = false;
    };
  }, [playId]);

  // 구간 재생 반주 URL. 곡 상세에는 없고 채보 자산에 있다. 내장 곡·실패는 합성음만 재생한다
  useEffect(() => {
    const id = log?.chartVersionId;
    if (id == null) return;
    const ac = new AbortController();
    getChartAssets(id, ac.signal).then(
      (a) => setAccompanimentUrl(a.accompanimentUrl ?? null),
      () => {},
    );
    return () => ac.abort();
  }, [log?.chartVersionId]);

  // PENDING인 동안만 리포트를 다시 받는다. 노트·히스토그램은 다시 요청하지 않는다
  useEffect(() => {
    if (!pending) return;
    const poller = createAnalysisPoller({
      intervalMs: ANALYSIS_POLL_INTERVAL_MS,
      max: ANALYSIS_POLL_MAX,
      refresh: () => refreshReport(playId),
      onReport: (v) => setReport({ s: 'ok', v }),
      onExhausted: () => setPolling('exhausted'),
    });
    poller.start();
    return poller.stop;
  }, [playId, pending, pollRun]);

  const title = log?.title ? `${log.title} 연주 리포트` : '연주 리포트';
  const slowRate = slowRateOf(report.s === 'ok' ? report.v.playbackRate : undefined) ?? slowRateOf(log?.playbackRate);
  const meta =
    report.s === 'ok'
      ? [
          MODE_LABEL[report.v.mode] ?? report.v.mode,
          report.v.difficulty ? (DIFFICULTY_LABEL[report.v.difficulty] ?? report.v.difficulty) : (log?.difficulty ?? ''),
          INPUT_LABEL[report.v.inputSource] ?? report.v.inputSource,
          // 연습 속도로 친 판이면 배율을 적는다(서버 응답 playbackRate, 없으면 이 브라우저의 로그)
          slowRate !== null ? `${rateLabel(slowRate)} 속도로 연습` : '',
          log ? new Date(log.startedAt).toLocaleString('ko-KR') : '',
        ].filter((t) => t !== '')
      : [];
  const header = (
    <header className="rp-header">
      <div>
        <h1>{title}</h1>
        {meta.length > 0 && <p className="rp-header-meta">{meta.join(' · ')}</p>}
      </div>
      <div className="rp-header-actions">
        {log && (
          <Link to={`/result/${playId}`} className="btn-ghost as-button">
            결과 화면
          </Link>
        )}
        <Link to={log?.mode === 'SHEET' ? '/sheet' : '/play'} className="btn-ghost as-button">
          곡 선택
        </Link>
      </div>
    </header>
  );

  if (report.s === 'loading') {
    return (
      <main className="main rp">
        {header}
        <p className="rp-notice">분석을 불러오는 중…</p>
      </main>
    );
  }
  if (report.s === 'error') {
    const d = describeError(report.e);
    return (
      <main className="main rp">
        {header}
        <InlineError size="lg" style={{ marginTop: 16 }} onRetry={d.retry ? onRetry : undefined} action={d.login ? <Link to="/login">로그인</Link> : undefined}>
          {d.text}
        </InlineError>
      </main>
    );
  }

  const r = report.v;
  const focus = picked ?? initialFocus(groups, noteList ?? [], totalMs);
  /** 구간을 고르고 확대 영역으로 화면을 옮긴다(관찰 목록의 버튼) */
  const openFocus = (f: Focus) => {
    setPicked(f);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('rp-focus')?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const transitionRows: ObservationRow[] = groups.transitions.map((seg: WeakSegment, i) => {
    const f = focusOfTransition(seg, noteList ?? []);
    const w = transitionWindow(noteList ?? [], seg, seg.pattern === 'TRANSITION_MISS');
    return {
      key: `${f.key}:${i}`,
      ...observationText(seg),
      // 열 구간이 없으면(전환 노트를 못 찾았고 약점 구간도 비어 있음) 버튼을 두지 않는다
      action: w.toMs > w.fromMs ? { text: `${clockRange(w.fromMs, w.toMs)} 예시 보기`, onClick: () => openFocus(f), pressed: focus?.key === f.key } : undefined,
    };
  });
  const otherRows: ObservationRow[] = groups.others.map((seg: WeakSegment, i) => {
    const f = focusOfSegment(seg);
    return {
      key: `${f.key}:${i}`,
      ...observationText(seg),
      action: seg.scope === 'WHOLE' ? undefined : { text: '구간 보기', onClick: () => openFocus(f), pressed: focus?.key === f.key },
    };
  });
  const notice = (
    <AnalysisNotice
      status={r.analysisStatus}
      segments={r.weakSegments}
      counts={r.counts}
      polling={polling}
      onRefresh={() => {
        setPolling('polling');
        setPollRun((n) => n + 1);
      }}
    />
  );

  return (
    <main className="main rp">
      {header}
      <StatsLine report={r} />
      <CoachSummaryCard summary={r.coachSummary} />

      {notes.s === 'ok' ? (
        <NoteFlowChart
          bins={bins}
          totalMs={totalMs}
          clusters={groups.clusters}
          focus={focus}
          // 막대는 항상 그 5초를 연다. 놓친 구간은 아래 구간 버튼으로 연다(겹치는 막대가 구간을 대신 열면 그 막대의 나머지 노트를 볼 수 없다)
          onPickBin={(fromMs) => setPicked(focusOfBin(fromMs))}
          onPickCluster={(seg) => setPicked(focusOfCluster(seg))}
          notice={notice}
        />
      ) : (
        <section className="rp-flow" aria-labelledby="rp-flow-title">
          <div className="rp-flow-header">
            <h2 id="rp-flow-title">전체 노트 흐름</h2>
          </div>
          {notes.s === 'loading' && <p className="rp-notice">노트를 불러오는 중…</p>}
          {notes.s === 'error' && (
            <InlineError style={{ marginTop: 14 }} onRetry={onRetry}>
              {describeError(notes.e).text}
            </InlineError>
          )}
          {notice}
        </section>
      )}

      {/* 화면 이동의 목적지는 이 틀이다. 안쪽 FocusPanel은 선택마다 다시 만들어져서, 거기로 부드럽게 옮기면 도중에 목적지가 사라져 이동이 끊긴다 */}
      <div id="rp-focus" className="rp-focus-anchor">
        {focus && <FocusPanel key={focus.key} focus={focus} notes={noteList} notesFailed={notes.s === 'error'} player={player} accompanimentUrl={accompanimentUrl} />}
      </div>

      <ObservationList id="rp-transitions-title" title="패드 전환 관찰" rows={transitionRows} />
      <ObservationList id="rp-others-title" title="그 밖의 관찰" rows={otherRows} />

      <PadTable stats={r.padStats}>
        <details className="rp-more">
          <summary>타이밍 분포 보기</summary>
          <TimingHistogram histogram={r.histogram} perfectMs={log?.timing.perfectMs ?? null} />
        </details>
      </PadTable>

      {recoEnabled && r.analysisStatus === 'DONE' && drillEntry.status === 'ready' && (
        <div className="rp-reco">
          <RecommendRow
            caption="이 약점 연습하기"
            items={drillEntry.cards}
            onPick={(item) => {
              void clickReco(item, drillEntry.requestId);
              navigate(recommendationPathOf(item, r.mode));
            }}
          />
        </div>
      )}

      {recoEnabled && recoEntry.status === 'ready' && (
        <div className="rp-reco">
          <RecommendRow
            caption="추천 곡"
            items={recoEntry.cards}
            onPick={(item) => {
              // 기록은 기다리지 않는다(D5)
              void clickReco(item, recoEntry.requestId);
              navigate(recommendationPathOf(item, r.mode));
            }}
          />
        </div>
      )}

      {recoEnabled && similarSongId !== null && similarEntry.status === 'ready' && (
        <div className="rp-reco">
          <RecommendRow
            caption="방금 친 곡과 비슷한 곡"
            items={similarEntry.cards}
            onPick={(card) => {
              void clickReco(card, similarEntry.requestId);
              navigate(recommendationPathOf(card, r.mode));
            }}
          />
        </div>
      )}
    </main>
  );
}
