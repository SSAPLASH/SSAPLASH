// 4 자동 채보: 음원 → 드럼만 분리 → 채보. 연출 모드는 스크롤로 층이 겹쳐 바뀌고(탭은 표시용),
// 모션 줄이기는 탭 버튼으로 직접 전환한다(기본 '채보').
import { m, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { chartArt, VIZ_HEIGHT, VIZ_WIDTH, waveformBars, type RectShape } from '@/features/landing/components/landingArt';
import { CHART_COPY } from '@/features/landing/components/landingContent';
import { chartLayerOpacity, chartTab } from '@/features/landing/domain/landingMotion';
import { useSceneProgress } from './useSceneProgress';

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
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const progress = useSceneProgress(ref);
  const op0 = useTransform(progress, (p) => chartLayerOpacity(p)[0]);
  const op1 = useTransform(progress, (p) => chartLayerOpacity(p)[1]);
  const op2 = useTransform(progress, (p) => chartLayerOpacity(p)[2]);
  const ops = [op0, op1, op2];

  // 직접 고르는 탭(모션 줄이기)과 스크롤이 정하는 탭(경계를 넘을 때만 갱신)
  const [manualTab, setTab] = useState(2);
  const [autoTab, setAutoTab] = useState<0 | 1 | 2>(0);
  const lastTab = useRef<0 | 1 | 2>(0);
  useMotionValueEvent(progress, 'change', (p) => {
    const next = chartTab(p);
    if (next === lastTab.current) return;
    lastTab.current = next;
    setAutoTab(next);
  });
  const tab = reduce ? manualTab : autoTab;
  const layer = (i: number) => (reduce && tab === i ? 'lp-layer lp-on' : 'lp-layer');
  const layerStyle = (i: number) => (reduce ? undefined : { opacity: ops[i] });

  return (
    <section ref={ref} className={reduce ? 'lp-scene lp-ai lp-static' : 'lp-scene lp-ai'} id="ai">
      <div className="lp-sticky lp-frame">
        <p className="lp-kicker">{CHART_COPY.kicker}</p>
        <h2 className="lp-h2">
          {CHART_COPY.title[0]}
          <br />
          {CHART_COPY.title[1]}
        </h2>
        <p className="lp-ai-sub">{CHART_COPY.sub}</p>
        {reduce ? (
          <div className="lp-pipe-tabs" role="tablist" aria-label="채보 만드는 과정">
            {CHART_COPY.tabs.map((label, i) => (
              <button key={label} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'lp-on' : undefined} onClick={() => setTab(i)}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="lp-pipe-tabs" aria-hidden="true">
            {CHART_COPY.tabs.map((label, i) => (
              <span key={label} className={tab === i ? 'lp-on' : undefined}>
                {label}
              </span>
            ))}
          </div>
        )}
        <div className="lp-viz" role={reduce ? 'tabpanel' : undefined} aria-label={reduce ? CHART_COPY.tabs[tab] : undefined}>
          <m.svg className={layer(0)} style={layerStyle(0)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
            <VizLabel>{CHART_COPY.labels.mix}</VizLabel>
            <Rects items={WAVES.mix} />
          </m.svg>
          <m.svg className={layer(1)} style={layerStyle(1)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
            <VizLabel>{CHART_COPY.labels.drum}</VizLabel>
            <Rects items={WAVES.drum} />
          </m.svg>
          <m.svg className={layer(2)} style={layerStyle(2)} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
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
          </m.svg>
        </div>
      </div>
    </section>
  );
}
