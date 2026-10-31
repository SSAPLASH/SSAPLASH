// 연주 결과 (리듬 게임 설계 4-2 · 악보 연주 설계 D11). localStorage 플레이 로그를 읽어 보여준다.
// 악보 연주(mode SHEET)는 점수·콤보 대신 정확도·판정 분포를 앞에 두고 피드백 카드·패드 요약을 붙인다.
// 곡이 삭제됐으면(곡 상세 404, CHART-001 U7) 결과는 그대로 보이고 "삭제된 곡" 표시와 함께 [다시 하기]·Enter만 숨긴다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FeedbackCards } from '@/components/FeedbackCards';
import { ReportEntry } from '@/components/ReportEntry';
import { checkSongAvailability } from '@/api/songs';
import { resumePlaySync, startPlaySync, usePlaySync, usePrefetchedReport } from '@/app/playSync';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { isServerPlayId } from '@/domain/playUpload';
import { SheetSnippet } from '@/components/SheetSnippet';
import { buildFeedback, chartFromLog, summarizeByPad } from '@/domain/feedback';
import { isUploadTarget } from '@/domain/report';
import { DELETED_SONG_LABEL, type SongAvailability } from '@/domain/songAvailability';
import { getPlayLog, type PlayLog } from '@/engine/playLog';

const DIFF_LABEL: Record<string, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

/** Δms 분포. −goodMs~+goodMs를 bins칸으로 나눈다 */
function histogram(log: PlayLog, bins = 12): { counts: number[]; perfectIdx: boolean[]; early: number | null; late: number | null } {
  const g = log.timing.goodMs;
  const p = log.timing.perfectMs;
  const counts = new Array<number>(bins).fill(0);
  const width = (2 * g) / bins;
  const perfectIdx = counts.map((_, i) => Math.abs(-g + (i + 0.5) * width) <= p);
  let eSum = 0;
  let eN = 0;
  let lSum = 0;
  let lN = 0;
  for (const n of log.notes) {
    if (n.deltaMs === null) continue;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((n.deltaMs + g) / width)));
    counts[i] += 1;
    if (n.deltaMs < 0) {
      eSum += n.deltaMs;
      eN += 1;
    } else if (n.deltaMs > 0) {
      lSum += n.deltaMs;
      lN += 1;
    }
  }
  return { counts, perfectIdx, early: eN ? eSum / eN : null, late: lN ? lSum / lN : null };
}

/** 모드별 선택 화면 경로 */
const pickPath = (l: PlayLog): string => (l.mode === 'SHEET' ? '/sheet' : '/play');

/** 같은 곡 준비 화면. BE 곡이면 URL로 복원하고, 로그에 id가 없으면(내장·이전 로그) 모드별 선택 화면으로 간다 */
const retryPath = (l: PlayLog): string =>
  l.songNumericId != null && l.chartId != null
    ? `${pickPath(l)}?song=${l.songNumericId}&chart=${l.chartId}`
    : pickPath(l);

export function ResultPage() {
  const { playId } = useParams();
  const navigate = useNavigate();
  const log = useMemo(() => (playId ? getPlayLog(playId) : null), [playId]);

  // 서버 업로드 상태(설계 COACH-002 4-1). 진입 시 한 번 끊긴 업로드·재시도 가능한 실패를 다시 보낸다 —
  // 연주 직후라면 이미 진행 중이라 무시된다
  const legacy = !playId || !isServerPlayId(playId);
  const liveUpload = usePlaySync((s) => (playId ? s.states[playId] : undefined));
  const uploadState = liveUpload ?? log?.upload;
  // 업로드 대상이면 분석은 서버(AI) 하나로 일원화해 로컬 카드를 숨긴다(COACH-003 D3). 프리패치된 리포트만 구독하고 재조회하지 않는다
  const uploadTarget = isUploadTarget(legacy, uploadState);
  const prefetchedReport = usePrefetchedReport(log?.playId);
  useEffect(() => {
    if (playId && !legacy) resumePlaySync(playId);
  }, [playId, legacy]);

  // 악보 연주 피드백. 로그에 bpm·박자가 있으면 마디 규칙까지, 이전 로그(필드 없음)는 마디 규칙을 건너뛴다
  const isSheet = log?.mode === 'SHEET';
  // 로컬 피드백 카드·미니 악보·패드 요약 표를 보일지. 업로드 대상이면 만들지 않는다
  const showLocalFeedback = isSheet && !uploadTarget;
  const feedback = useMemo(() => (log && showLocalFeedback ? buildFeedback(log, log.bpm ? { bpm: log.bpm, beatsPerBar: log.beatsPerBar, offsetMs: log.offsetMs } : undefined) : []), [log, showLocalFeedback]);
  const summary = useMemo(() => (log && showLocalFeedback ? summarizeByPad(log) : []), [log, showLocalFeedback]);
  // 약점 마디 미니 악보. 이전 로그(bpm 없음)는 채보를 못 만들어 스니펫·카드 클릭이 없다
  const snippetChart = useMemo(() => (log && showLocalFeedback ? chartFromLog(log) : null), [log, showLocalFeedback]);
  const noteStates = useMemo(() => (log ? log.notes.map((n) => n.judgement) : []), [log]);
  // 카드를 누르기 전에는 bars가 있는 첫 카드. 로그가 바뀌면(다른 결과) 선택을 버린다
  const [picked, setPicked] = useState<{ playId: string; bars: [number, number] } | null>(null);
  const focusBars: [number, number] | null =
    picked && picked.playId === log?.playId ? picked.bars : (feedback.find((f) => f.bars)?.bars ?? null);
  const snippetRef = useRef<HTMLDivElement>(null);
  const focus = (bars: [number, number]) => {
    if (log) setPicked({ playId: log.playId, bars });
    snippetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // 이 기록의 BE 곡이 아직 있는지(U7). 확인 전·확인 실패는 지금처럼 다시 하기를 둔다
  const [availability, setAvailability] = useState<{ playId: string; value: SongAvailability } | null>(null);
  useEffect(() => {
    const id = log?.songNumericId;
    if (!log || typeof id !== 'number') return;
    const ctrl = new AbortController();
    const owner = log.playId;
    checkSongAvailability(id, ctrl.signal).then(
      (value) => setAvailability({ playId: owner, value }),
      () => {},
    );
    return () => ctrl.abort();
  }, [log]);
  const songDeleted = availability !== null && availability.playId === log?.playId && availability.value === 'deleted';

  const retry = () => {
    if (log && !songDeleted) navigate(retryPath(log));
  };

  // Enter = 다시 하기(지운 곡이면 하지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' || !log || songDeleted) return;
      // D1: 링크·버튼·입력 칸이 소유한 Enter는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented || isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      e.preventDefault();
      navigate(retryPath(log));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, navigate, songDeleted]);

  if (!log) {
    return (
      <main className="main">
        <section className="hero">
          <h1>결과를 찾을 수 없습니다</h1>
          <p>이 브라우저에 저장된 최근 20건에 없는 기록입니다.</p>
          <Link to="/play">곡 선택으로</Link>
        </section>
      </main>
    );
  }

  const h = histogram(log);
  const maxCount = Math.max(1, ...h.counts);
  const s = log.summary;
  const total = s.counts.PERFECT + s.counts.GOOD + s.counts.MISS;

  return (
    <main className="main">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h1>{log.title}</h1>
            {songDeleted && <span className="deleted-song-badge">{DELETED_SONG_LABEL}</span>}
          </div>
          <div className="small dim">
            {DIFF_LABEL[log.difficulty] ?? log.difficulty} · 입력 {log.inputSource} · {new Date(log.startedAt).toLocaleString('ko-KR')}
          </div>
        </div>
        <div className="row">
          {!songDeleted && (
            <button className="btn-primary" onClick={retry}>
              {isSheet ? '같은 곡 다시 (Enter)' : '다시 하기 (Enter)'}
            </button>
          )}
          <Link to={pickPath(log)} className={songDeleted ? 'btn-primary' : 'btn-ghost'}>
            다른 곡
          </Link>
          <Link to="/free" className="btn-ghost">
            자유 연습
          </Link>
        </div>
      </div>

      <ReportEntry
        playId={log.playId}
        legacy={legacy}
        state={uploadState}
        report={prefetchedReport}
        onRetry={() => void startPlaySync(log.playId)}
      />

      <div className="result-grid">
        {!isSheet && (
          <div className="card stat">
            <span className="v">{s.score}</span>
            <span className="k">점수 / {s.maxScore}</span>
          </div>
        )}
        <div className="card stat">
          <span className="v">{(s.accuracy * 100).toFixed(1)}%</span>
          <span className="k">정확도</span>
        </div>
        {isSheet ? (
          <div className="card stat">
            <span className="v">
              {s.counts.PERFECT} / {s.counts.GOOD} / {s.counts.MISS}
            </span>
            <span className="k">Perfect / Good / Miss</span>
          </div>
        ) : (
          <div className="card stat">
            <span className="v">{s.maxCombo}</span>
            <span className="k">최대 콤보</span>
          </div>
        )}
        <div className="card stat">
          <span className="v">{s.strayHits}</span>
          <span className="k">채보 외 타격 (감점 없음)</span>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card col">
          <h3>판정 분포</h3>
          <table className="plain">
            <tbody>
              <tr>
                <td>Perfect</td>
                <td style={{ textAlign: 'right' }}>{s.counts.PERFECT}</td>
              </tr>
              <tr>
                <td>Good</td>
                <td style={{ textAlign: 'right' }}>{s.counts.GOOD}</td>
              </tr>
              <tr>
                <td>Miss</td>
                <td style={{ textAlign: 'right' }}>{s.counts.MISS}</td>
              </tr>
              <tr>
                <td className="dim">노트 합계</td>
                <td style={{ textAlign: 'right' }}>{total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card col">
          <h3>타이밍</h3>
          <div className="hist" aria-label="타이밍 히스토그램">
            {h.counts.map((c, i) => (
              <div key={i} className={h.perfectIdx[i] ? 'p' : ''} style={{ height: `${(c / maxCount) * 100}%` }} title={`${c}`} />
            ))}
          </div>
          <div className="hist-axis">
            <span>빠름 −{log.timing.goodMs}ms</span>
            <span>0</span>
            <span>늦음 +{log.timing.goodMs}ms</span>
          </div>
          <div className="small dim">
            빠름 평균 {h.early === null ? '–' : `${h.early.toFixed(0)}ms`} · 늦음 평균 {h.late === null ? '–' : `+${h.late.toFixed(0)}ms`} · 판정 폭 ±
            {log.timing.perfectMs}/±{log.timing.goodMs}ms
          </div>
        </div>
      </div>

      {showLocalFeedback && snippetChart && focusBars && (
        <div className="card col" ref={snippetRef} style={{ marginTop: 16 }}>
          <h3>{focusBars[0] === focusBars[1] ? `약점 ${focusBars[0] + 1}마디` : `약점 마디 ${focusBars[0] + 1}~${focusBars[1] + 1}`}</h3>
          <SheetSnippet chart={snippetChart} noteStates={noteStates} bars={focusBars} />
          <div className="small dim">카드를 누르면 구간이 바뀝니다</div>
        </div>
      )}

      {showLocalFeedback && (
        <div style={{ marginTop: 16 }}>
          <h3>간단 피드백</h3>
          <FeedbackCards items={feedback} summary={summary} onFocusBars={snippetChart ? focus : undefined} />
        </div>
      )}
    </main>
  );
}
