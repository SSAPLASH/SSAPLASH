// 지표 줄: 단계의 필수(M) 지표를 카드로 그린다. 값·단위·상태 색·기준 한 줄.
import { memo } from 'react';
import type { HealthItem } from '@/features/monitor/core/health';

export const MetricRow = memo(function MetricRow({ items }: { items: readonly HealthItem[] }) {
  return (
    <div className="mon-metrics">
      {items.map((it) => (
        <div key={it.key} className={`mon-metric ${it.level}`} title={it.basis}>
          <div className="mon-metric-label">{it.label}</div>
          <div className="mon-metric-value">
            {it.value}
            {it.unit && <span className="mon-metric-unit"> {it.unit}</span>}
          </div>
          <div className="mon-metric-basis">{it.basis}</div>
        </div>
      ))}
    </div>
  );
});
