// 「악보 보고 빨리 치기」 결과 본문. 「문제별 반응 시간」 판: 문제마다 막대 하나, 틀려서 더해진 시간은 빨간 끝으로 보인다.
// 행마다 속도 단계(data-grade)를 달아 막대와 시간 숫자의 색을 CSS가 고르게 한다. 막대는 왼쪽부터 차례로 자란다(--i는 행 순번).
import type { CSSProperties } from 'react';
import { answerGrade, barParts, barScaleMs, formatSeconds, padName, FAST_MS, GOOD_MS, type SightAnswer } from '@/features/mini/domain/sightRound';
import './sight.css';

interface Props {
  /** 끝난 문제(낸 순서) */
  answers: readonly SightAnswer[];
}

/** 범례 네 칸. 경계 값은 FAST_MS·GOOD_MS와 같다 */
const LEGEND = [
  ['fast', `빠름 ${formatSeconds(FAST_MS)}초 이하`],
  ['good', `보통 ${formatSeconds(GOOD_MS)}초 이하`],
  ['slow', '느림'],
  ['bad', '틀려서 더해진 0.5초'],
] as const;

export function SightResult({ answers }: Props) {
  const scale = barScaleMs(answers);
  return (
    <section className="mini-chart-panel mini-sight-result" aria-labelledby="mini-sight-result-title">
      <h3 id="mini-sight-result-title" className="mini-chart-title">
        문제별 반응 시간
      </h3>
      {/* 색 범례. 색은 CSS가 data-grade로 고른다 */}
      <div className="mini-sight-legend">
        {LEGEND.map(([grade, text]) => (
          <span key={grade} className="mini-sight-legend-item" data-grade={grade}>
            {text}
          </span>
        ))}
      </div>
      <ol className="mini-sight-rows">
        {answers.map((answer, i) => {
          const { base, penalty } = barParts(answer, scale);
          return (
            <li key={i} className="mini-sight-row" data-grade={answerGrade(answer)} data-testid={`mini-sight-row-${i}`}>
              <span className="mini-sight-row-no">{i + 1}</span>
              <span className="mini-sight-row-pad">{padName(answer.pad)}</span>
              <div className="mini-sight-row-bar" aria-hidden="true">
                <span className="mini-sight-row-fill" style={{ '--i': i } as CSSProperties}>
                  <span className="mini-sight-bar-base" style={{ width: `${base * 100}%` }} />
                  {penalty > 0 ? <span className="mini-sight-bar-penalty" style={{ width: `${penalty * 100}%` }} /> : null}
                </span>
              </div>
              <span className={`mini-sight-row-time${answer.timedOut ? ' is-bad' : ''}`}>
                {answer.timedOut ? (
                  '시간 초과'
                ) : (
                  <>
                    {formatSeconds(answer.ms)}
                    <small>초</small>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
