// 패드별 정확도 막대 + 평균 Δ·평균 세기. 표본이 없는 값(null)은 "–"
import type { PadStat } from '@/domain/report';
import { ALL_PADS, PAD_META } from '@/domain/pads';

const dash = '–';
const fmtDelta = (d: number | null) => (d === null ? dash : `${d > 0 ? '+' : ''}${d.toFixed(0)}ms`);

export function PadAccuracyChart({ stats }: { stats: PadStat[] }) {
  const rows = [...stats].sort((a, b) => ALL_PADS.indexOf(a.pad) - ALL_PADS.indexOf(b.pad));
  if (!rows.length) return <p className="small dim">패드 통계가 없습니다.</p>;
  return (
    <div className="pad-acc">
      {rows.map((s) => {
        const meta = PAD_META[s.pad];
        const total = s.counts.PERFECT + s.counts.GOOD + s.counts.MISS;
        return (
          <div key={s.pad} className="pad-acc-row">
            <span className="pad-acc-name">{meta.label}</span>
            <div className="pad-acc-bar" aria-hidden>
              <div style={{ width: `${(s.accuracy ?? 0) * 100}%`, background: meta.color }} />
            </div>
            <span className="pad-acc-v">{s.accuracy === null ? dash : `${(s.accuracy * 100).toFixed(1)}%`}</span>
            <span className="small dim pad-acc-meta">
              {total}노트 · Δ {fmtDelta(s.meanDeltaMs)} · 세기 {s.meanVelocity === null ? dash : s.meanVelocity.toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
