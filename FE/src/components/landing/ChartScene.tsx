// 4 자동 채보: 음원 → 드럼만 분리 → 채보. 정적 버전은 탭으로 레이어를 전환한다(기본 '채보').
import { useState } from 'react';
import { chartArt, VIZ_HEIGHT, VIZ_WIDTH, waveformBars, type RectShape } from './landingArt';
import { CHART_COPY } from './landingContent';

const WAVES = waveformBars();
const CHART = chartArt();
const VIEW_BOX = `0 0 ${VIZ_WIDTH} ${VIZ_HEIGHT}`;

function Rects({ items }: { items: RectShape[] }) {
  return items.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={r.rx} fill={r.fill} />);
}

function VizLabel({ children }: { children: string }) {
  return (
    <text x="22" y="34" fontSize="13" fontWeight="600" fill="#6e6e73">
      {children}
    </text>
  );
}

export function ChartScene() {
  const [tab, setTab] = useState(2);
  const layer = (i: number) => (tab === i ? 'lp-layer lp-on' : 'lp-layer');

  return (
    <section className="lp-scene lp-ai" id="ai">
      <div className="lp-frame">
        <p className="lp-kicker">{CHART_COPY.kicker}</p>
        <h2 className="lp-h2">
          {CHART_COPY.title[0]}
          <br />
          {CHART_COPY.title[1]}
        </h2>
        <p className="lp-ai-sub">{CHART_COPY.sub}</p>
        <div className="lp-pipe-tabs" role="tablist" aria-label="채보 만드는 과정">
          {CHART_COPY.tabs.map((label, i) => (
            <button key={label} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'lp-on' : undefined} onClick={() => setTab(i)}>
              {label}
            </button>
          ))}
        </div>
        <div className="lp-viz" role="tabpanel" aria-label={CHART_COPY.tabs[tab]}>
          <svg className={layer(0)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
            <VizLabel>{CHART_COPY.labels.mix}</VizLabel>
            <Rects items={WAVES.mix} />
          </svg>
          <svg className={layer(1)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
            <VizLabel>{CHART_COPY.labels.drum}</VizLabel>
            <Rects items={WAVES.drum} />
          </svg>
          <svg className={layer(2)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
            <VizLabel>{CHART_COPY.labels.chart}</VizLabel>
            {CHART.lanes.map((l) => (
              <g key={l.key}>
                <line x1={l.line.x1} x2={l.line.x2} y1={l.line.y1} y2={l.line.y2} stroke={l.line.stroke} />
                <text x="40" y={l.y + 4} fontSize="12" fontWeight="700" fill="#8e8e93" letterSpacing="1">
                  {l.label}
                </text>
              </g>
            ))}
            {CHART.barLines.map((l, i) => (
              <line key={i} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke={l.stroke} />
            ))}
            <Rects items={CHART.notes} />
          </svg>
        </div>
      </div>
    </section>
  );
}
