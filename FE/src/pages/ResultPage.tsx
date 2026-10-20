// 리듬 게임 결과 (설계 4-2 결과 단계). localStorage 플레이 로그를 읽어 보여준다.
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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

export function ResultPage() {
  const { playId } = useParams();
  const navigate = useNavigate();
  const log = useMemo(() => (playId ? getPlayLog(playId) : null), [playId]);

  const retry = () => {
    if (log) navigate('/play', { state: { songId: log.songId } });
  };

  // Enter = 다시 하기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && log) {
        e.preventDefault();
        navigate('/play', { state: { songId: log.songId } });
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
            다시 하기 (Enter)
          </button>
          <Link to="/play" className="btn-ghost">
            다른 곡
          </Link>
          <Link to="/free" className="btn-ghost">
            자유 연주
          </Link>
        </div>
      </div>

      <div className="result-grid">
        <div className="card stat">
          <span className="v">{s.score}</span>
          <span className="k">점수 / {s.maxScore}</span>
        </div>
        <div className="card stat">
          <span className="v">{(s.accuracy * 100).toFixed(1)}%</span>
          <span className="k">정확도</span>
        </div>
        <div className="card stat">
          <span className="v">{s.maxCombo}</span>
          <span className="k">최대 콤보</span>
        </div>
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
    </main>
  );
}
