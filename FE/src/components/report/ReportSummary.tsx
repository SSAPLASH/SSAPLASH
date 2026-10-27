// 리포트 요약 카드: 점수·정확도·최대 콤보·판정 분포. 모두 서버 값
import type { Report } from '@/domain/report';

export function ReportSummary({ report: r }: { report: Report }) {
  return (
    <div className="result-grid">
      <div className="card stat">
        <span className="v">{r.score}</span>
        <span className="k">점수</span>
      </div>
      <div className="card stat">
        <span className="v">{(r.accuracy * 100).toFixed(1)}%</span>
        <span className="k">정확도</span>
      </div>
      <div className="card stat">
        <span className="v">{r.maxCombo}</span>
        <span className="k">최대 콤보</span>
      </div>
      <div className="card stat">
        <span className="v">
          {r.counts.PERFECT} / {r.counts.GOOD} / {r.counts.MISS}
        </span>
        <span className="k">Perfect / Good / Miss</span>
      </div>
    </div>
  );
}
