// 「누구보다 빠르게」 결과 본문 (Figma 1182:38353). 칸 3개 + 「1초마다 친 횟수」 판.
import { SecondBars } from '@/features/mini/components/speed/SecondBars';
import { StatCells, type StatCell } from '@/features/mini/components/StatCells';

interface Props {
  cells: readonly StatCell[];
  perSecond: readonly number[];
  /** 가장 많이 친 초(0부터). 0타면 없음 */
  highlight?: number;
}

export function SpeedResult({ cells, perSecond, highlight }: Props) {
  return (
    <>
      <StatCells cells={cells} />
      <section className="mini-chart-panel" aria-labelledby="mini-speed-chart-title">
        <h3 id="mini-speed-chart-title" className="mini-chart-title">
          1초마다 친 횟수
        </h3>
        <SecondBars perSecond={perSecond} variant="chart" highlight={highlight} />
      </section>
    </>
  );
}
