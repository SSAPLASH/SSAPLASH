// 「전체 노트 흐름」 (설계 COACH-002 리포트 화면 개편 2·4장). 곡 전체를 5초 칸으로 묶은 판정 막대와 놓친 구간 버튼 줄.
// 막대(칸)를 누르거나 구간 버튼을 누르면 페이지에 알린다. 선택 상태는 페이지가 든다.
// 칸에 마우스를 올리거나 초점을 주면 그 5초의 시각과 판정 수가 뜬다.
// 막대는 색 3개(정확 · 빠름·늦음 · 놓침)이고, 빠름과 늦음의 수는 툴팁과 읽어 주는 글에서 나눈다(설계 COACH-002-report-timing-direction D5).
// 구간 버튼은 마디 격자가 있으면 시각 앞에 마디를 붙인다(D8). 5초 칸과 시간축은 시각만 쓴다 — 칸이 마디와 맞지 않는다.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { WeakSegment } from '@/domain/play/report';
import {
  binTotal,
  clockSecond,
  clockTenth,
  FLOW_BIN_MS,
  metricNumber,
  OFF_BEAT_LABEL,
  VERDICT_LABEL,
  withBars,
  type FlowBin,
  type Focus,
  type ReportGrid,
} from '@/features/result/domain/reportView';
import './report.css';

interface Props {
  bins: FlowBin[];
  /** 시간축 길이(ms) */
  totalMs: number;
  /** 놓친 노트가 모인 구간(시각순) */
  clusters: WeakSegment[];
  /** 지금 확대 중인 구간. 없으면 띠를 그리지 않는다 */
  focus: Focus | null;
  onPickBin: (fromMs: number) => void;
  onPickCluster: (seg: WeakSegment) => void;
  /** 구간 버튼 줄 아래에 둘 분석 상태 안내 */
  notice?: ReactNode;
  /** 마디 격자. 있으면 구간 버튼에 마디를 같이 적는다 */
  grid?: ReportGrid | null;
  /** 연습 속도로 친 기록이면 시각이 원래 빠르기 기준임을 알린다(D7) */
  slow?: boolean;
}

interface Tip {
  index: number;
  x: number;
  y: number;
}

/** 구간 버튼 한 줄의 높이(px) */
const MARKER_ROW = 48;
const MARKER_TOP = 12;
/** 구간 버튼이 오른쪽 끝을 넘지 않게 남겨 두는 폭(px). 마디를 같이 적으면 그만큼 넓다 */
const MARKER_ROOM = 190;
const MARKER_ROOM_BARS = 300;

/** 칸 사이 간격(px). 긴 곡은 칸이 많아 간격이 막대를 다 차지하므로 줄인다(5분 초과 1px, 10분 초과 0) */
const barGap = (count: number) => (count > 120 ? 0 : count > 60 ? 1 : 3);

const pct = (ms: number, totalMs: number) => (totalMs > 0 ? (100 * ms) / totalMs : 0);

export function NoteFlowChart({ bins, totalMs, clusters, focus, onPickBin, onPickCluster, notice, grid = null, slow = false }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const max = Math.max(1, ...bins.map(binTotal));
  const tipBin = tip ? bins[tip.index] : null;
  const range = (b: FlowBin) => `${clockSecond(b.fromMs)}–${clockSecond(b.fromMs + FLOW_BIN_MS)}`;
  const markerRoom = grid ? MARKER_ROOM_BARS : MARKER_ROOM;

  return (
    <section className="rp-flow" aria-labelledby="rp-flow-title">
      <div className="rp-flow-header">
        <div className="rp-flow-title">
          <h2 id="rp-flow-title">전체 노트 흐름</h2>
          {slow && <span className="rp-flow-note">시각은 원래 빠르기 기준이에요</span>}
        </div>
        <div className="rp-legend" role="group" aria-label="판정 범례">
          <span className="p">{VERDICT_LABEL.PERFECT}</span>
          <span className="g">{OFF_BEAT_LABEL}</span>
          <span className="m">{VERDICT_LABEL.MISS}</span>
        </div>
      </div>

      <div className="rp-overview" role="group" aria-label={`0:00부터 ${clockSecond(totalMs)}까지 5초 단위 노트 판정 분포`}>
        <div className="rp-bars" style={{ '--rp-gap': `${barGap(bins.length)}px` } as CSSProperties}>
          {bins.map((b, i) => (
            <button
              key={b.fromMs}
              type="button"
              className="rp-bin"
              style={{ '--rp-delay': `${i * 8}ms` } as CSSProperties}
              aria-label={`${range(b)}: ${VERDICT_LABEL.PERFECT} ${b.perfect}, ${VERDICT_LABEL.EARLY} ${b.early}, ${VERDICT_LABEL.LATE} ${b.late}, ${VERDICT_LABEL.MISS} ${b.miss}`}
              aria-pressed={focus?.kind === 'bin' && focus.fromMs === b.fromMs}
              onClick={() => onPickBin(b.fromMs)}
              onPointerEnter={(e) => setTip({ index: i, x: e.clientX, y: e.clientY })}
              onPointerMove={(e) => setTip({ index: i, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => setTip(null)}
              onFocus={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTip({ index: i, x: r.left + r.width / 2, y: r.top });
              }}
              onBlur={() => setTip(null)}
            >
              <span className="p" style={{ height: `${(100 * b.perfect) / max}%` }} />
              <span className="g" style={{ height: `${(100 * b.good) / max}%` }} />
              <span className="m" style={{ height: `${(100 * b.miss) / max}%` }} />
            </button>
          ))}
        </div>
        {clusters.map((c) => (
          <span
            key={`${c.fromMs}:${c.toMs}`}
            className="rp-range-outline"
            style={{ left: `${pct(c.fromMs, totalMs)}%`, width: `${pct(c.toMs - c.fromMs, totalMs)}%` }}
            aria-hidden="true"
          />
        ))}
        {focus && (
          <div className="rp-band" style={{ left: `${pct(focus.fromMs, totalMs)}%`, width: `${pct(focus.toMs - focus.fromMs, totalMs)}%` }} aria-hidden="true" />
        )}
      </div>

      <div className="rp-axis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i}>{clockSecond((totalMs * i) / 3)}</span>
        ))}
      </div>

      {clusters.length > 0 && (
        <div className="rp-markers" role="group" aria-label="놓친 노트가 모인 구간" style={{ height: MARKER_TOP + clusters.length * MARKER_ROW }}>
          {clusters.map((c, i) => {
            const left = pct(c.fromMs, totalMs);
            const top = MARKER_TOP + i * MARKER_ROW;
            const missed = metricNumber(c, 'missCount');
            const pressed = focus?.kind === 'cluster' && focus.fromMs === c.fromMs && focus.toMs === c.toMs;
            return (
              <span key={`${c.fromMs}:${c.toMs}`}>
                <span className="rp-stem" style={{ left: `${pct(c.fromMs + (c.toMs - c.fromMs) / 2, totalMs)}%`, height: top }} aria-hidden="true" />
                <button
                  type="button"
                  className="rp-marker"
                  style={{ top, left: `min(${left}%, calc(100% - ${markerRoom}px))` }}
                  aria-controls="rp-focus"
                  aria-pressed={pressed}
                  onClick={() => onPickCluster(c)}
                >
                  <span>{withBars(`${clockTenth(c.fromMs)}–${clockTenth(c.toMs)}`, c.fromMs, c.toMs, grid)}</span>
                  {missed !== null && <span className="rp-marker-count">{missed}개 놓침</span>}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {notice}

      {tip && tipBin && (
        <div className="rp-tip" role="tooltip" style={{ left: Math.max(8, Math.min(tip.x + 12, (typeof window === 'undefined' ? tip.x : window.innerWidth) - 160)), top: tip.y - 10 }}>
          <strong>{range(tipBin)}</strong>
          <span className="total">{binTotal(tipBin) > 0 ? `총 ${binTotal(tipBin)}개` : '노트 없음'}</span>
          <span>
            {VERDICT_LABEL.PERFECT} {tipBin.perfect}
          </span>
          <span>
            {VERDICT_LABEL.EARLY} {tipBin.early}
          </span>
          <span>
            {VERDICT_LABEL.LATE} {tipBin.late}
          </span>
          <span>
            {VERDICT_LABEL.MISS} {tipBin.miss}
          </span>
        </div>
      )}
    </section>
  );
}
