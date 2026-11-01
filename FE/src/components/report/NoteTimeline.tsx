// 노트 타임라인: 가로 = 곡 시각, 세로 = 패드 줄, 점 색 = 판정. 노트는 시간순으로 받은 것을 그린다
import type { ReportNote } from '@/domain/report';
import { ALL_PADS, PAD_META } from '@/domain/pads';

const W = 1000;
const LANE = 22;
const LABEL = 64;
const COLOR = { PERFECT: 'var(--perfect)', GOOD: 'var(--good)', MISS: 'var(--miss)' } as const;

export function NoteTimeline({ notes }: { notes: ReportNote[] }) {
  if (!notes.length) return <p className="small dim">노트가 없습니다.</p>;
  const pads = ALL_PADS.filter((p) => notes.some((n) => n.pad === p));
  const t0 = Math.min(0, notes[0].timeMs);
  const t1 = Math.max(t0 + 1, notes[notes.length - 1].timeMs);
  const x = (t: number) => LABEL + ((t - t0) / (t1 - t0)) * (W - LABEL - 8);
  const h = pads.length * LANE + 8;
  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label="노트 판정 타임라인">
        {pads.map((p, i) => (
          <g key={p}>
            <line x1={LABEL} x2={W - 8} y1={i * LANE + LANE / 2 + 4} y2={i * LANE + LANE / 2 + 4} stroke="var(--line)" />
            <text x={0} y={i * LANE + LANE / 2 + 8} fill="var(--text-2)" fontSize={12}>
              {PAD_META[p].label}
            </text>
          </g>
        ))}
        {notes.map((n) => (
          <circle key={n.seq} cx={x(n.timeMs)} cy={pads.indexOf(n.pad) * LANE + LANE / 2 + 4} r={4} fill={COLOR[n.judgement]}>
            <title>{`${(n.timeMs / 1000).toFixed(2)}s ${PAD_META[n.pad].label} ${n.judgement}${n.deltaMs === null ? '' : ` ${n.deltaMs > 0 ? '+' : ''}${n.deltaMs.toFixed(0)}ms`}`}</title>
          </circle>
        ))}
      </svg>
      <div className="row small dim">
        <span>
          <i className="dot" style={{ background: COLOR.PERFECT }} /> Perfect
        </span>
        <span>
          <i className="dot" style={{ background: COLOR.GOOD }} /> Good
        </span>
        <span>
          <i className="dot" style={{ background: COLOR.MISS }} /> Miss
        </span>
        <span>· {notes.length}노트</span>
      </div>
    </div>
  );
}
