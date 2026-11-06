// Figma Feedback / ResultSummaryCard 126:3795 — 왼쪽 곡 제목·메타, 오른쪽 지표 묶음(672:4132: 점수·최고 콤보 | 세로선 | 정확도 64, 간격 48, 아래 정렬).
// 악보 모드는 점수 블록과 세로선 없이 정확도만 있다.
import type { ReactNode } from 'react';
import './result.css';

export interface ResultSummaryCardProps {
  title: string;
  /** 제목 아래 한 줄(아티스트·BPM·길이·모드·날짜) */
  meta: string;
  /** 제목 옆 칩(삭제된 곡 등) */
  titleBadge?: ReactNode;
  /** 가운데 「점수 / 최고 콤보」 블록. 없으면 그리지 않는다 */
  scoreText?: string;
  /** 정확도 표기(예: 96.8%) */
  accuracyText: string;
}

export function ResultSummaryCard({ title, meta, titleBadge, scoreText, accuracyText }: ResultSummaryCardProps) {
  return (
    <section className="result-summary" aria-label="결과 요약">
      <div className="result-summary-song">
        <div className="result-summary-title-row">
          <h1 className="result-summary-title">{title}</h1>
          {titleBadge}
        </div>
        <p className="result-summary-meta">{meta}</p>
      </div>
      <div className="result-summary-metrics">
        {scoreText ? (
          <>
            <div className="result-summary-block result-summary-score">
              <span className="result-summary-label">점수 / 최고 콤보</span>
              <span className="t-display-20">{scoreText}</span>
            </div>
            <span className="result-summary-divider" aria-hidden="true" />
          </>
        ) : null}
        <div className="result-summary-block">
          <span className="result-summary-label">정확도</span>
          <span className="t-display-64 result-summary-accuracy">{accuracyText}</span>
        </div>
      </div>
    </section>
  );
}
