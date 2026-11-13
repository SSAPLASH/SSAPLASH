// 서버 타이밍 히스토그램. 칸 i = [fromMs + i × binMs, +binMs). Perfect 폭을 알면(로컬 로그) 그 안의 칸을 강조한다
import type { Report } from '@/domain/play/report';

export function TimingHistogram({ histogram: h, perfectMs }: { histogram: Report['histogram']; perfectMs: number | null }) {
  if (!h || !h.counts.length) return <p className="small dim">타이밍 표본이 없습니다.</p>;
  const max = Math.max(1, ...h.counts);
  const toMs = h.fromMs + h.counts.length * h.binMs;
  return (
    <>
      <div className="hist" aria-label="타이밍 히스토그램">
        {h.counts.map((c, i) => {
          const from = h.fromMs + i * h.binMs;
          const mid = from + h.binMs / 2;
          const p = perfectMs !== null && Math.abs(mid) <= perfectMs;
          return <div key={i} className={p ? 'p' : ''} style={{ height: `${(c / max) * 100}%` }} title={`${from}~${from + h.binMs}ms: ${c}`} />;
        })}
      </div>
      <div className="hist-axis">
        <span>빠름 {h.fromMs}ms</span>
        <span>0</span>
        <span>늦음 +{toMs}ms</span>
      </div>
    </>
  );
}
