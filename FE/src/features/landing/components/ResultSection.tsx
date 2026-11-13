// 6 연주 결과: 놓친 마디를 악보로 보여 주는 예시 + 지표 3개. 각 요소는 화면에 들어오면 떠오른다(reveal).
import { useRef } from 'react';
import { SHEET_RED, sheetArt } from './landingArt';
import { RESULT_COPY, RESULT_STATS } from './landingContent';
import { joinClass, useReveal } from './useReveal';

const SHEET = sheetArt();

export function ResultSection() {
  const h = SHEET.highlight;
  // 시안 .reveal 문서 순서 0~4
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const kicker = useReveal(kickerRef, 0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title = useReveal(titleRef, 1);
  const subRef = useRef<HTMLParagraphElement>(null);
  const sub = useReveal(subRef, 2);
  const cardRef = useRef<HTMLDivElement>(null);
  const card = useReveal(cardRef, 3);
  const statsRef = useRef<HTMLDivElement>(null);
  const stats = useReveal(statsRef, 4);
  return (
    <section className="lp-section" id="result">
      <p ref={kickerRef} className={joinClass('lp-kicker', kicker.className)} style={kicker.style}>
        {RESULT_COPY.kicker}
      </p>
      <h2 ref={titleRef} className={joinClass('lp-h2', title.className)} style={title.style}>
        {RESULT_COPY.title[0]}
        <br />
        {RESULT_COPY.title[1]}
      </h2>
      <p ref={subRef} className={joinClass('lp-ai-sub', sub.className)} style={{ margin: '18px auto 0', ...sub.style }}>
        {RESULT_COPY.sub}
      </p>
      <div ref={cardRef} className={joinClass('lp-sheet-card', card.className)} style={card.style}>
        <div className="lp-sheet-meta">
          <b>{RESULT_COPY.sheetTitle}</b>
          <span>{RESULT_COPY.sheetNote}</span>
        </div>
        <svg viewBox="0 0 900 150" aria-hidden="true">
          <defs>
            {/* 놓친 음표 네온 번짐: 가까운 빛과 먼 빛을 겹친 뒤 원래 음표를 위에 다시 그린다 */}
            <filter id="lp-neon-red" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="near" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="far" />
              <feMerge>
                <feMergeNode in="far" />
                <feMergeNode in="near" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect x={h.x} y={h.y} width={h.width} height={h.height} rx={h.rx} fill="rgba(0,113,227,.09)" stroke="#0071e3" strokeWidth="1.5" />
          <text x={h.labelX} y={h.labelY} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0071e3">
            3마디
          </text>
          {SHEET.staffLines.map((l, i) => (
            <line key={`s${i}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke={l.stroke} strokeWidth={l.strokeWidth} />
          ))}
          {SHEET.barLines.map((l, i) => (
            <line key={`b${i}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke={l.stroke} strokeWidth={l.strokeWidth} />
          ))}
          {SHEET.hihats.map((hh, i) => (
            <g key={`h${i}`}>
              <path d={hh.d} stroke="#1d1d1f" strokeWidth="1.6" />
              <line x1={hh.stem.x1} x2={hh.stem.x2} y1={hh.stem.y1} y2={hh.stem.y2} stroke={hh.stem.stroke} strokeWidth={hh.stem.strokeWidth} opacity={hh.stem.opacity} />
            </g>
          ))}
          {SHEET.notes.map((n, i) => (
            <ellipse
              key={`n${i}`}
              cx={n.cx}
              cy={n.cy}
              rx={n.rx}
              ry={n.ry}
              fill={n.fill}
              filter={n.fill === SHEET_RED ? 'url(#lp-neon-red)' : undefined}
            />
          ))}
          {SHEET.beams.map((l, i) => (
            <line key={`m${i}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke={l.stroke} strokeWidth={l.strokeWidth} />
          ))}
        </svg>
      </div>
      <div ref={statsRef} className={joinClass('lp-stats', stats.className)} style={stats.style}>
        {RESULT_STATS.map((s) => (
          <div key={s.cls} className={`lp-stat lp-${s.cls}`}>
            <div className="lp-k">{s.key}</div>
            <div className="lp-v">{s.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
