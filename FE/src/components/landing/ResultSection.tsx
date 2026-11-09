// 6 연주 결과: 놓친 마디를 악보로 보여 주는 예시 + 지표 3개. 정적 버전(reveal 없음).
import { sheetArt } from './landingArt';
import { RESULT_COPY, RESULT_STATS } from './landingContent';

const SHEET = sheetArt();

export function ResultSection() {
  const h = SHEET.highlight;
  return (
    <section className="lp-section" id="result">
      <p className="lp-kicker">{RESULT_COPY.kicker}</p>
      <h2 className="lp-h2">
        {RESULT_COPY.title[0]}
        <br />
        {RESULT_COPY.title[1]}
      </h2>
      <p className="lp-ai-sub" style={{ margin: '18px auto 0' }}>
        {RESULT_COPY.sub}
      </p>
      <div className="lp-sheet-card">
        <div className="lp-sheet-meta">
          <b>{RESULT_COPY.sheetTitle}</b>
          <span>{RESULT_COPY.sheetNote}</span>
        </div>
        <svg viewBox="0 0 900 150" aria-hidden="true">
          <rect x={h.x} y={h.y} width={h.width} height={h.height} rx={h.rx} fill="rgba(0,113,227,.09)" stroke="#0071e3" strokeWidth="1.5" />
          <text x={h.labelX} y={h.labelY} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0071e3">
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
            <ellipse key={`n${i}`} cx={n.cx} cy={n.cy} rx={n.rx} ry={n.ry} fill={n.fill} />
          ))}
          {SHEET.beams.map((l, i) => (
            <line key={`m${i}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke={l.stroke} strokeWidth={l.strokeWidth} />
          ))}
        </svg>
      </div>
      <div className="lp-stats">
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
