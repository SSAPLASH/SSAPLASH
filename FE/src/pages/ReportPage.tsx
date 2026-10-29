// 연주 상세 분석 (COACH-002, 설계 COACH-002 4-3). 서버 리포트만 쓴다 — 로컬 결과 값과 섞지 않는다(D5).
// 요약이 오면 바로 그리고, 노트 타임라인은 페이지를 끝까지 받아 시간순 정렬한 뒤 그린다(D8).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createAnalysisPoller } from '@/app/analysisPoller';
import { loadAllReportNotes, prefetchReport, refreshReport, reportErrorKind } from '@/app/playSync';
import { NoteTimeline } from '@/components/report/NoteTimeline';
import { PadAccuracyChart } from '@/components/report/PadAccuracyChart';
import { ReportSummary } from '@/components/report/ReportSummary';
import { TimingHistogram } from '@/components/report/TimingHistogram';
import { WeakSegments, type PollingState } from '@/components/report/WeakSegments';
import type { Report, ReportNote } from '@/domain/report';
import { getPlayLog } from '@/engine/playLog';

type Load<T> = { s: 'loading' } | { s: 'ok'; v: T } | { s: 'error'; e: unknown };

/** PENDING 리포트 재조회 간격·최대 횟수 (COACH-003 3-5) */
const ANALYSIS_POLL_INTERVAL_MS = 2000;
const ANALYSIS_POLL_MAX = 5;

const MODE_LABEL: Record<string, string> = { RHYTHM: '리듬 게임', SHEET: '악보 연습' };
const INPUT_LABEL: Record<string, string> = { KEYBOARD: '키보드', STICK: '스틱' };

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
  // 다시 시도하면 key가 바뀌어 처음 상태(불러오는 중)부터 다시 시작한다
  return <ReportView key={`${playId}:${attempt}`} playId={playId} onRetry={() => setAttempt((a) => a + 1)} />;
}

function ReportView({ playId, onRetry }: { playId: string; onRetry: () => void }) {
  const log = useMemo(() => getPlayLog(playId), [playId]);
  const [report, setReport] = useState<Load<Report>>({ s: 'loading' });
  const [notes, setNotes] = useState<Load<ReportNote[]>>({ s: 'loading' });
  const [polling, setPolling] = useState<PollingState>('idle');
  // 새로고침 버튼이 올리면 재조회를 5회부터 다시 시작한다
  const [pollRun, setPollRun] = useState(0);
  const pending = report.s === 'ok' && report.v.analysisStatus === 'PENDING';

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

  const title = log?.title ?? '연주 리포트';
  const header = (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h1>{title} · 상세 분석</h1>
        <div className="small dim">
          {report.s === 'ok' && `${MODE_LABEL[report.v.mode] ?? report.v.mode} · 입력 ${INPUT_LABEL[report.v.inputSource] ?? report.v.inputSource}`}
          {log && ` · ${new Date(log.startedAt).toLocaleString('ko-KR')}`}
        </div>
      </div>
      <div className="row">
        {log && (
          <Link to={`/result/${playId}`} className="btn-ghost as-button">
            결과 화면
          </Link>
        )}
        <Link to={log?.mode === 'SHEET' ? '/sheet' : '/play'} className="btn-ghost as-button">
          곡 선택
        </Link>
      </div>
    </div>
  );

  if (report.s === 'loading') {
    return (
      <main className="main">
        {header}
        <p className="dim">분석을 불러오는 중…</p>
      </main>
    );
  }
  if (report.s === 'error') {
    const d = describeError(report.e);
    return (
      <main className="main">
        {header}
        <div className="notice error row">
          <span>{d.text}</span>
          {d.retry && <button onClick={onRetry}>다시 시도</button>}
          {d.login && <Link to="/login">로그인</Link>}
        </div>
      </main>
    );
  }

  const r = report.v;
  return (
    <main className="main">
      {header}
      <ReportSummary report={r} />

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card col">
          <h3>패드별 정확도</h3>
          <PadAccuracyChart stats={r.padStats} />
        </div>
        <div className="card col">
          <h3>타이밍</h3>
          <TimingHistogram histogram={r.histogram} perfectMs={log?.timing.perfectMs ?? null} />
        </div>
      </div>

      <div className="card col" style={{ marginTop: 16 }}>
        <h3>노트 흐름</h3>
        {notes.s === 'loading' && <p className="small dim">노트를 불러오는 중…</p>}
        {notes.s === 'error' && (
          <div className="notice error row">
            <span>{describeError(notes.e).text}</span>
            <button onClick={onRetry}>다시 시도</button>
          </div>
        )}
        {notes.s === 'ok' && <NoteTimeline notes={notes.v} />}
      </div>

      <div style={{ marginTop: 16 }}>
        <WeakSegments
          status={r.analysisStatus}
          segments={r.weakSegments}
          counts={r.counts}
          bars={log?.mode === 'SHEET' && log.bpm ? { bpm: log.bpm, beatsPerBar: log.beatsPerBar } : null}
          polling={polling}
          onRefresh={() => {
            setPolling('polling');
            setPollRun((n) => n + 1);
          }}
        />
      </div>
    </main>
  );
}
