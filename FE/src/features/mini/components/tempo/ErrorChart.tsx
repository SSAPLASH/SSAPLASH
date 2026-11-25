// 타격마다 박 격자에서 벗어난 정도 그림. 가운데 선이 정박, 위가 빠름·아래가 늦음이다.
// 눈에 보이는 그림은 장식이고(aria-hidden), 같은 내용을 화면 낭독기용 목록으로 따로 둔다.
import { STEADY_BAND_MS } from '@/features/mini/domain/tempoRound';
import { errorSide, formatError } from '@/features/mini/domain/timingError';
import './tempo.css';

// viewBox 단위. 글자는 12 이상으로 둔다(좁은 화면에서 줄어도 읽히게)
const W = 680;
const H = 240;
const LEFT = 88; // 빠름·늦음·정박 글자 자리
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 32; // 타격 번호 자리
const HALF_H = (H - TOP - BOTTOM) / 2;
const CENTER_Y = TOP + HALF_H;
const DOT_R = 5;

interface Props {
  /** 타격별 오차(ms, 음수면 빠름). 첫 값은 기준이라 0이다 */
  errors: readonly number[];
  /** 세로 눈금 끝(ms). 그림의 위 끝이 −scaleMs(빠름), 아래 끝이 +scaleMs(늦음) */
  scaleMs: number;
}

export function ErrorChart({ errors, scaleMs }: Props) {
  const scale = scaleMs > 0 ? scaleMs : 1;
  const bandH = Math.min(1, STEADY_BAND_MS / scale) * HALF_H;
  const plotW = W - LEFT - RIGHT;
  const step = plotW / Math.max(1, errors.length);
  const xAt = (i: number) => LEFT + step * (i + 0.5);

  return (
    <div className="mini-tempo-chart">
      <svg className="mini-tempo-chart-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        <rect className="mini-tempo-chart-band" x={LEFT} y={CENTER_Y - bandH} width={plotW} height={bandH * 2} />
        {/* 띠 이름은 왼쪽 여백에 둔다. 그림 안에 두면 타격 점과 겹친다 */}
        <text className="mini-tempo-chart-band-label" x={LEFT - 8} y={CENTER_Y + 4} textAnchor="end">
          {`정박 ±${STEADY_BAND_MS}ms`}
        </text>
        <line className="mini-tempo-chart-axis" x1={LEFT} y1={CENTER_Y} x2={W - RIGHT} y2={CENTER_Y} />
        <text className="mini-tempo-chart-side" x={LEFT - 8} y={TOP + 12} textAnchor="end">
          빠름
        </text>
        <text className="mini-tempo-chart-side" x={LEFT - 8} y={H - BOTTOM - 2} textAnchor="end">
          늦음
        </text>
        {errors.map((error, i) => {
          const x = xAt(i);
          const y = CENTER_Y + Math.max(-1, Math.min(1, error / scale)) * HALF_H;
          const off = Math.abs(error) > STEADY_BAND_MS;
          return (
            <g
              key={i}
              className={`mini-tempo-chart-hit is-${errorSide(error)}${off ? ' is-off' : ''}`}
              data-testid={`mini-tempo-hit-${i}`}
              data-error={error}
            >
              <line x1={x} y1={CENTER_Y} x2={x} y2={y} />
              <circle cx={x} cy={y} r={DOT_R} />
              <text className="mini-tempo-chart-no" x={x} y={H - 10} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <ol className="mini-tempo-sr">
        {errors.map((error, i) => (
          <li key={i}>{i === 0 ? '1번째 기준' : `${i + 1}번째 ${formatError(error)}`}</li>
        ))}
      </ol>
    </div>
  );
}
