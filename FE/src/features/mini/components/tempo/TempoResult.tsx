// 「인간 메트로놈」 결과 본문. 칸 3개 + 「타격마다 벗어난 정도」 판.
import { StatCells, type StatCell } from '@/features/mini/components/StatCells';
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
        <ErrorChart errors={errors} scaleMs={scaleMs} />
      </section>
    </>
  );
}
