// 악보 모드 피드백 카드 + 패드별 요약 표 (MODE-sheet-practice 2·3-3)
import { PAD_META } from '@/domain/pads';
import type { FeedbackItem, PadSummary } from '@/domain/feedback';

interface Props {
  items: FeedbackItem[];
  summary: PadSummary[];
  /** 마디 범위가 있는 카드를 눌렀을 때 (0부터, 양쪽 포함) */
  onFocusBars?: (bars: [number, number]) => void;
}

function fmtDelta(ms: number | null): string {
  return ms === null ? '–' : `${ms >= 0 ? '+' : '-'}${Math.abs(ms).toFixed(0)}ms`;
}

export function FeedbackCards({ items, summary, onFocusBars }: Props) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="sheet-cards">
        {items.map((it, i) => {
          const bars = it.bars;
          const body = (
            <>
              <span className="no">{i + 1}</span>
              <h3>{it.title}</h3>
              <p className="dim">{it.body}</p>
              <p className="small">{it.suggestion}</p>
              {bars && <span className="small faint">눌러서 악보에서 보기</span>}
            </>
          );
          return bars && onFocusBars ? (
            <button key={it.id} type="button" className="card sheet-card clickable" onClick={() => onFocusBars(bars)}>
              {body}
            </button>
          ) : (
            <div key={it.id} className="card sheet-card">
              {body}
            </div>
          );
        })}
      </div>
      <div className="card col">
        <h3>패드별 요약</h3>
        <table className="plain">
          <thead>
            <tr className="small dim">
              <th style={{ textAlign: 'left' }}>패드</th>
              <th>노트</th>
              <th>PERFECT</th>
              <th>GOOD</th>
              <th>MISS</th>
              <th>평균 Δ</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.pad} style={{ textAlign: 'center' }}>
                <td style={{ textAlign: 'left', color: PAD_META[s.pad].color, fontWeight: 700 }}>
                  {PAD_META[s.pad].label}
                </td>
                <td>{s.total}</td>
                <td>{s.perfect}</td>
                <td>{s.good}</td>
                <td>{s.miss}</td>
                <td>{fmtDelta(s.meanDeltaMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
