// 정답 자리와 내 타격 그림. 도식이라 정답 선 둘레만 비례하고 나머지는 모양만 낸다.
// 눈에 보이는 그림은 장식이고(aria-hidden), 같은 내용을 화면 낭독기용 문장으로 따로 둔다.
import {
  CHART_CLAMP_MS,
  SHOT_TOLERANCE_MS,
  chartOffsetMs,
  formatSigned,
  type ShotOutcome,
} from '@/features/mini/domain/oneShotRound';
import './oneshot.css';

// viewBox 단위. 글자는 12 이상으로 둔다(좁은 화면에서 줄어도 읽히게)
const W = 680;
const H = 200;
const MID_Y = 100; // 막대·선이 놓인 가운데 높이
const ANSWER_X = 430;
const HALF = 110; // 정답 선에서 ±CHART_CLAMP_MS 까지의 픽셀 반폭
const ZONE_TOP = 56;
const ZONE_BOTTOM = 144;
const BAR_W = 8;
const BAR_GAP = 6;
const SONG_X = 16;
const CHORUS_X = 566;
const SONG_BARS = [30, 46, 58, 40, 66, 50, 34, 60, 44, 54, 38, 62] as const;
const CHORUS_BARS = [48, 66, 40, 58, 70, 44, 62, 52] as const;
const REST_START_X = SONG_X + SONG_BARS.length * (BAR_W + BAR_GAP);
const DOT_R = 7;

interface Props {
  outcome: ShotOutcome;
}

function bars(xStart: number, heights: readonly number[]) {
  return heights.map((h, i) => (
    <rect
      key={i}
      x={xStart + i * (BAR_W + BAR_GAP)}
      y={MID_Y - h / 2}
      width={BAR_W}
      height={h}
      rx={BAR_W / 2}
    />
  ));
}

export function ShotChart({ outcome }: Props) {
  const bandHalf = (SHOT_TOLERANCE_MS / CHART_CLAMP_MS) * HALF;
  const hasError = 'errorMs' in outcome;
  const offset = hasError ? chartOffsetMs(outcome.errorMs) : 0;
  const hitX = ANSWER_X + (offset / CHART_CLAMP_MS) * HALF;
  const srText = hasError
    ? outcome.errorMs === 0
      ? '내 타격은 정답과 같아요'
      : `내 타격은 정답보다 ${Math.abs(outcome.errorMs)}ms ${outcome.errorMs < 0 ? '빠름' : '늦음'}`
    : '타격 위치를 재지 못했어요';

  return (
    <div className="mini-oneshot-chart">
      <svg className="mini-oneshot-chart-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        <g className="mini-oneshot-chart-song">{bars(SONG_X, SONG_BARS)}</g>
        <line
          className="mini-oneshot-chart-rest"
          x1={REST_START_X}
          y1={MID_Y}
          x2={ANSWER_X - HALF}
          y2={MID_Y}
        />
        <text
          className="mini-oneshot-chart-label"
          x={(REST_START_X + ANSWER_X - HALF) / 2}
          y={MID_Y - 10}
          textAnchor="middle"
        >
          정적
        </text>
        <rect
          className="mini-oneshot-chart-band"
          data-testid="mini-oneshot-band"
          x={ANSWER_X - bandHalf}
          y={ZONE_TOP}
          width={bandHalf * 2}
          height={ZONE_BOTTOM - ZONE_TOP}
        />
        <line className="mini-oneshot-chart-answer" x1={ANSWER_X} y1={ZONE_TOP - 6} x2={ANSWER_X} y2={ZONE_BOTTOM + 6} />
        <text className="mini-oneshot-chart-label" x={ANSWER_X} y={20} textAnchor="middle">
          {`허용 범위 ±${SHOT_TOLERANCE_MS}ms`}
        </text>
        <text className="mini-oneshot-chart-label is-strong" x={ANSWER_X} y={40} textAnchor="middle">
          정답
        </text>
        {hasError ? (
          <g
            className={`mini-oneshot-chart-hit is-${outcome.kind === 'success' ? 'good' : 'bad'}`}
            data-testid="mini-oneshot-hit"
            data-offset={offset}
          >
            <circle cx={hitX} cy={MID_Y} r={DOT_R} />
            <text x={hitX} y={ZONE_BOTTOM + 34} textAnchor="middle">
              {`내 타격 ${formatSigned(outcome.errorMs)}ms`}
            </text>
          </g>
        ) : null}
        <g className={`mini-oneshot-chart-chorus${outcome.kind === 'success' ? '' : ' is-dim'}`}>
          {bars(CHORUS_X, CHORUS_BARS)}
        </g>
      </svg>
      <p className="mini-oneshot-sr">{srText}</p>
    </div>
  );
}
