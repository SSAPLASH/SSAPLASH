// Figma Feedback / TimingHistogram 126:4267 — 타이밍 분포 막대(퍼펙트 범위 --perfect, 그 밖 --good)와 빠름·정확·늦음 축.
import { Card } from '@/components/ui/layout/Card';
import './result.css';

export interface TimingHistogramProps {
  counts: number[];
  perfectIdx: boolean[];
  goodMs: number;
  /** 평균 Δ(ms). 없으면 「–」 */
  meanDeltaMs: number | null;
  /** 막대 영역 툴팁(빠름·늦음 평균, 판정 폭) */
  detail?: string;
}

const signed = (ms: number) => `${ms >= 0 ? '+' : '−'}${Math.abs(ms).toFixed(0)}ms`;

export function TimingHistogram({ counts, perfectIdx, goodMs, meanDeltaMs, detail }: TimingHistogramProps) {
  const max = Math.max(1, ...counts);
  return (
    <Card padding="lg" className="result-panel">
      <div className="result-panel-head">
        <h2 className="result-panel-title">타이밍 분포</h2>
        <span className="result-caption">평균 {meanDeltaMs === null ? '–' : signed(meanDeltaMs)}</span>
      </div>
      <div className="result-hist" role="img" aria-label="타이밍 분포 막대 그래프" title={detail}>
        {counts.map((c, i) => (
          <div
            key={i}
            className={perfectIdx[i] ? 'result-hist-bar perfect' : 'result-hist-bar'}
            style={{ height: `${(c / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="result-hist-axis">
        <span>빠름 −{goodMs}ms</span>
        <span>정확 0ms</span>
        <span>늦음 +{goodMs}ms</span>
      </div>
    </Card>
  );
}
