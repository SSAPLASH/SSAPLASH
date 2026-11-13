// Figma Controls / TableHeader 134:2686 + Feedback / PadSummaryRow 126:4143 — 패드별 타격 수·정확도·평균 세기·평균 타이밍 표.
// 평균 타이밍 열은 ≤1024px에서 숨긴다(설계 1-1 #10).
import { PAD_META } from '@/domain/kit/pads';
import type { PadSummary } from '@/features/result/domain/feedback';
import '@/components/ui/layout/table.css';
import './result.css';

const fmtDelta = (ms: number | null) => (ms === null ? '—' : `${ms >= 0 ? '+' : '−'}${Math.abs(ms).toFixed(0)}ms`);

export function PadSummaryTable({ summary, openHihat }: { summary: PadSummary[]; openHihat?: { text: string; label: string } | null }) {
  return (
    <div className="result-table-wrap">
      <table className="ui-table result-table" aria-label="패드별 요약">
        <thead>
          <tr>
            <th scope="col">패드</th>
            <th scope="col">타격 수</th>
            <th scope="col">정확도</th>
            <th scope="col">평균 세기</th>
            <th scope="col" className="result-col-timing">
              평균 타이밍
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.pad}>
              <td>{PAD_META[s.pad].label}{s.pad === 'HIHAT' && openHihat && <span className="result-open-hihat" aria-label={openHihat.label}>{openHihat.text}</span>}</td>
              <td>{s.total}회</td>
              <td>{(s.accuracy * 100).toFixed(1)}%</td>
              <td>{s.meanVelocity === null ? '—' : `${s.meanVelocity} / 100`}</td>
              <td className="result-col-timing">{fmtDelta(s.meanDeltaMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
