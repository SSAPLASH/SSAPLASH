// Figma Feedback / JudgeBar 126:3767 — 판정 분포 막대 3줄(PERFECT·GOOD·MISS). 막대 폭 = 개수 / 총합.
import { Card } from '@/components/ui/layout/Card';
import './result.css';

export interface JudgeBarsProps {
  counts: { PERFECT: number; GOOD: number; MISS: number };
  /** 채보 외 타격 수. 0이면 캡션을 그리지 않는다 */
  strayHits?: number;
}

const ROWS = [
  { key: 'PERFECT', cls: 'perfect' },
  { key: 'GOOD', cls: 'good' },
  { key: 'MISS', cls: 'miss' },
] as const;

export function JudgeBars({ counts, strayHits = 0 }: JudgeBarsProps) {
  const total = counts.PERFECT + counts.GOOD + counts.MISS;
  return (
    <Card padding="lg" className="result-panel">
      <h2 className="result-panel-title">판정 분포 · 총 {total}회</h2>
      <div className="result-judge-rows">
        {ROWS.map((r) => (
          <div key={r.key} className="result-judge-row">
            <span className={`result-judge-label result-judge-${r.cls}`}>{r.key}</span>
            <div className="result-judge-track" role="img" aria-label={`${r.key} ${counts[r.key]}회`}>
              <div
                className={`result-judge-fill result-judge-bg-${r.cls}`}
                style={{ width: total ? `${(counts[r.key] / total) * 100}%` : 0 }}
              />
            </div>
            <span className="result-judge-count">{counts[r.key]}</span>
          </div>
        ))}
      </div>
      {strayHits > 0 ? <p className="result-caption">채보 외 타격 {strayHits}회 · 감점 없음</p> : null}
    </Card>
  );
}
