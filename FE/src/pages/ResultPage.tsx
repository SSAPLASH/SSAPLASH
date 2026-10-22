// 연주 결과 (리듬 게임 설계 4-2 · 악보 연주 설계 D11). localStorage 플레이 로그를 읽어 보여준다.
// 악보 연주(mode SHEET)는 점수·콤보 대신 정확도·판정 분포를 앞에 두고 피드백 카드·패드 요약을 붙인다.
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FeedbackCards } from '@/components/FeedbackCards';
import { buildFeedback, summarizeByPad } from '@/domain/feedback';
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

  // 악보 연주 피드백. 로그에 bpm·박자가 있으면 마디 규칙까지, 이전 로그(필드 없음)는 마디 규칙을 건너뛴다
  const isSheet = log?.mode === 'SHEET';
  const feedback = useMemo(() => (log && isSheet ? buildFeedback(log, log.bpm ? { bpm: log.bpm, beatsPerBar: log.beatsPerBar } : undefined) : []), [log, isSheet]);
  const summary = useMemo(() => (log && isSheet ? summarizeByPad(log) : []), [log, isSheet]);
  const retry = () => {
    if (log) navigate(retryPath(log));
  };

  // Enter = 다시 하기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && log) {
        e.preventDefault();
        navigate(retryPath(log));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, navigate]);

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
          <h1>{log.title}</h1>
          <div className="small dim">
            {DIFF_LABEL[log.difficulty] ?? log.difficulty} · 입력 {log.inputSource} · {new Date(log.startedAt).toLocaleString('ko-KR')}
          </div>
        </div>
        <div className="row">
          <button className="btn-primary" onClick={retry}>
            {isSheet ? '같은 곡 다시 (Enter)' : '다시 하기 (Enter)'}
          </button>
          <Link to={pickPath(log)} className="btn-ghost">
            다른 곡
          </Link>
          <Link to="/free" className="btn-ghost">
            자유 연주
          </Link>
        </div>
      </div>

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

      {isSheet && (
        <div style={{ marginTop: 16 }}>
          <FeedbackCards items={feedback} summary={summary} />
        </div>
      )}
    </main>
  );
}
