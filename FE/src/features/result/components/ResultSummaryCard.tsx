// Figma Feedback / ResultSummaryCard 126:3795 — 왼쪽 곡 제목·메타, 오른쪽 지표 묶음(672:4132: 점수·최고 콤보 | 세로선 | 정확도 64, 간격 48, 아래 정렬).
// 악보 모드는 점수 블록과 세로선 없이 정확도만 있다.
// 최고 기록 칩(recordBadge)·숫자 카운트업(countUp)·축하 캔버스 슬롯(celebration)은 설계 MODE-001-score-combo-fx 4-2.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import './result.css';

/** 결과 숫자 카운트업 길이(U5) */
export const RESULT_COUNT_SEC = 0.9;

export interface RecordBadge {
  /** first = 첫 기록 / new = 최고 기록 갱신 */
  kind: 'first' | 'new';
  text: string;
}

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
  /** 최고 기록 칩(첫 기록 / 갱신). 없으면 그리지 않는다 */
  recordBadge?: RecordBadge | null;
  /**
   * 숫자 카운트업. 값을 주면 0에서 값까지 900ms 동안 세어 올라간다(모션 줄이기면 바로 최종값).
   * 받은 texts(scoreText·accuracyText)는 최종 표기이고, 보간 중에는 render(p)가 만든 글자를 쓴다
   */
  countUp?: {
    /** 점수 블록 글자. p는 0~1 진행도 */
    score?: (p: number) => string;
    accuracy: (p: number) => string;
  };
  /** 카드 위에 겹치는 축하 캔버스(CelebrationFx) */
  celebration?: ReactNode;
}

/**
 * 진행도 p(0~1)로 글자를 만드는 숫자. 처음 렌더는 최종 글자(render(1))라 보간이 없으면 그대로다.
 * enabled면 레이아웃 효과에서 0으로 되돌린 뒤 MotionValue로 DOM 텍스트만 갱신한다(React 렌더 없음).
 */
function CountUp({ render, enabled, className, stat }: { render: (p: number) => string; enabled: boolean; className?: string; stat: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const p = useMotionValue(enabled ? 0 : 1);
  const renderRef = useRef(render);
  useLayoutEffect(() => {
    renderRef.current = render;
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    const write = (v: number) => {
      if (ref.current) ref.current.textContent = renderRef.current(v);
    };
    write(0);
    const off = p.on('change', write);
    const controls = animate(p, 1, { duration: RESULT_COUNT_SEC, ease: 'easeOut' });
    return () => {
      off();
      controls.stop();
      write(1);
    };
  }, [enabled, p]);
  return (
    <span ref={ref} className={className} data-stat={stat}>
      {render(1)}
    </span>
  );
}

export function ResultSummaryCard({ title, meta, titleBadge, scoreText, accuracyText, recordBadge, countUp, celebration }: ResultSummaryCardProps) {
  const reduced = useReducedMotion();
  const counting = countUp !== undefined && !reduced;
  return (
    <section className="result-summary" aria-label="결과 요약">
      <div className="result-summary-song">
        <div className="result-summary-title-row">
          <h1 className="result-summary-title">{title}</h1>
          {titleBadge}
          {recordBadge ? (
            <span className="result-record-chip" data-kind={recordBadge.kind}>
              {recordBadge.text}
            </span>
          ) : null}
        </div>
        <p className="result-summary-meta">{meta}</p>
      </div>
      <div className="result-summary-metrics">
        {scoreText ? (
          <>
            <div className="result-summary-block result-summary-score">
              <span className="result-summary-label">점수 / 최고 콤보</span>
              {countUp?.score ? <CountUp render={countUp.score} enabled={counting} className="t-display-20" stat="score" /> : <span className="t-display-20">{scoreText}</span>}
            </div>
            <span className="result-summary-divider" aria-hidden="true" />
          </>
        ) : null}
        <div className="result-summary-block">
          <span className="result-summary-label">정확도</span>
          {countUp ? (
            <CountUp render={countUp.accuracy} enabled={counting} className="t-display-64 result-summary-accuracy" stat="accuracy" />
          ) : (
            <span className="t-display-64 result-summary-accuracy">{accuracyText}</span>
          )}
        </div>
      </div>
      {celebration}
    </section>
  );
}
