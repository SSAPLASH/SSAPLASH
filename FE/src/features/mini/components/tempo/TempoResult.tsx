// 「인간 메트로놈」 결과 본문. 칸 3개 + 「타격마다 벗어난 정도」 판(색 범례와 그림).
import { StatCells, type StatCell } from '@/features/mini/components/StatCells';
import { GOOD_BAND_MS, STEADY_BAND_MS } from '@/features/mini/domain/tempoRound';
import { ErrorChart } from './ErrorChart';

interface Props {
  /** 결과 칸 3개(가장 벗어난 타·끝날 때 빠르기·흐름). 값은 페이지가 만든다 */
  cells: readonly StatCell[];
  /** 타격별 오차(ms) */
  errors: readonly number[];
  /** 그림 세로 눈금 끝(ms) */
  scaleMs: number;
}

export function TempoResult({ cells, errors, scaleMs }: Props) {
  return (
    <>
      <StatCells cells={cells} />
      <section className="mini-chart-panel" aria-labelledby="mini-tempo-chart-title">
        <h3 id="mini-tempo-chart-title" className="mini-chart-title">
          타격마다 벗어난 정도
        </h3>
        <div className="mini-tempo-legend" data-testid="mini-tempo-legend">
          <span className="mini-tempo-legend-item" data-grade="perfect">
            정박 ±{STEADY_BAND_MS}ms
          </span>
          <span className="mini-tempo-legend-item" data-grade="good">
            가까움 ±{GOOD_BAND_MS}ms
          </span>
          <span className="mini-tempo-legend-item" data-grade="off">
            벗어남
          </span>
          <span className="mini-tempo-legend-item" data-grade="base">
            기준(첫 타)
          </span>
        </div>
        <ErrorChart errors={errors} scaleMs={scaleMs} />
      </section>
    </>
  );
}
