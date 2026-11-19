// 하이라이트 (설계 COACH-002-report-apple-redesign ③). 둥근 면 하나를 칸으로 나누고 숫자마다 뜻을 보여 주는 작은 그림을 붙인다.
// 데이터가 없는 칸은 빼고 남은 칸끼리 폭을 나눈다. 그림은 모두 px·비율 style로 그려 브라우저마다 같게 보인다.
import type { CSSProperties, ReactNode } from 'react';
import { clockSecond, meanTimingText, timingScalePos, type RecentAccuracy, type TimingSummary } from '@/features/result/domain/reportView';
import './report.css';

interface Props {
  maxCombo: number;
  totalNotes: number;
  /** 맞힌 노트 오차 요약. null이면 평균 박자 칸을 뺀다 */
  timing: TimingSummary | null;
  /** 평균 박자 눈금의 반폭(ms) = 그 판의 GOOD 폭 */
  goodMs: number;
  /** 연주 시간(ms). null이면 칸을 뺀다 */
  durationMs: number | null;
  /** 연주한 마디 수. 격자를 모르면 null */
  bars: number | null;
  /** 같은 곡 최근 정확도. null이면 칸을 뺀다 */
  recent: RecentAccuracy | null;
}

interface Cell {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  viz?: ReactNode;
  note?: ReactNode;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);
const ICON_COMBO = 'M8.5 1L3 8h3.5L5.5 13 11 6H7.5z';
const ICON_PLAY = 'M4 2.5v9l7.5-4.5z';
const ICON_UP = 'M7 2l4.5 6h-9z';
const ICON_DOWN = 'M7 12L2.5 6h9z';
const ClockIcon = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
    <path d="M7 4v3.2l2.2 1.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </svg>
);

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Sparkline({ values }: { values: number[] }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.02, (hi - lo) * 0.15);
  const y = (v: number) => 28 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 26;
  const x = (i: number) => (values.length === 1 ? 100 : (100 * i) / (values.length - 1));
  const last = values[values.length - 1];
  return (
    <>
      <svg className="rp-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="rp-spark-end" style={{ top: `${(y(last) / 30) * 100}%` }} aria-hidden="true" />
    </>
  );
}

export function ReportHighlights({ maxCombo, totalNotes, timing, goodMs, durationMs, bars, recent }: Props) {
  const cells: Cell[] = [];
  const comboRate = totalNotes > 0 ? Math.min(1, maxCombo / totalNotes) : 0;
  cells.push({
    key: 'combo',
    icon: <Icon d={ICON_COMBO} />,
    label: '최대 콤보',
    value: String(maxCombo),
    unit: '연속',
    viz: (
      <div className="rp-meter" aria-hidden="true">
        <i style={{ width: pct(comboRate) }} />
      </div>
    ),
    note: totalNotes > 0 ? `전체 ${totalNotes}노트의 ${pct(comboRate)}` : undefined,
  });

  if (timing) {
    const t = meanTimingText(timing.meanMs);
    const lo = timingScalePos(timing.lowMs, goodMs);
    const hi = timingScalePos(timing.highMs, goodMs);
    cells.push({
      key: 'timing',
      icon: <ClockIcon />,
      label: '평균 박자',
      value: t.value,
      unit: t.unit,
      viz: (
        <div
          className="rp-scale"
          role="img"
          aria-label={`빠름 ${goodMs}ms부터 늦음 ${goodMs}ms 눈금에서 평균 ${t.value}${t.unit}, 가운데 절반은 ${Math.round(timing.lowMs)}~${Math.round(timing.highMs)}ms`}
        >
          <span className="rp-scale-track" />
          <span className="rp-scale-band" style={{ left: pct(lo), width: `${Math.max(1, Math.round((hi - lo) * 100))}%` }} />
          <span className="rp-scale-zero" />
          <span className="rp-scale-dot" style={{ left: pct(timingScalePos(timing.meanMs, goodMs)) }} />
        </div>
      ),
      note: (
        <span className="rp-scale-ends">
          <span>빠름 {goodMs}ms</span>
          <span>정박</span>
          <span>늦음 {goodMs}ms</span>
        </span>
      ),
    });
  }

  if (durationMs !== null && durationMs > 0) {
    cells.push({
      key: 'time',
      icon: <Icon d={ICON_PLAY} />,
      label: '연주 시간',
      value: clockSecond(durationMs),
      note: bars !== null && bars > 0 ? `${bars}마디` : undefined,
    });
  }

  if (recent) {
    const d = recent.diffPoint;
    const first = recent.values[0];
    const last = recent.values[recent.values.length - 1];
    cells.push({
      key: 'recent',
      icon: <Icon d={d < 0 ? ICON_DOWN : ICON_UP} />,
      label: '지난번보다',
      value: d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '0',
      unit: '%p',
      viz: (
        <div className="rp-spark-box" role="img" aria-label={`최근 ${recent.values.length}번 정확도 ${recent.values.map(pct).join(', ')}`}>
          <Sparkline values={recent.values} />
        </div>
      ),
      note: `최근 ${recent.values.length}번 ${pct(first)} → ${pct(last)}`,
    });
  }

  return (
    <div className="rp-highlights" role="group" aria-label="연주 하이라이트" style={{ '--rp-cells': cells.length } as CSSProperties}>
      {cells.map((c) => (
        <div key={c.key} className={`rp-hl rp-hl-${c.key}`}>
          <span className="rp-hl-label">
            {c.icon}
            {c.label}
          </span>
          <strong className="rp-hl-value">
            {c.value}
            {c.unit && <span>{c.unit}</span>}
          </strong>
          {c.viz && <div className="rp-hl-viz">{c.viz}</div>}
          {c.note && <div className="rp-hl-note">{c.note}</div>}
        </div>
      ))}
    </div>
  );
}
