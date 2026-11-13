// HIT 탭: 요약 줄 + 스트립 차트 + HIT 표(최근 200건). 오류·drop 행을 같은 시간축에 끼워 넣는다.
// 행은 React.memo로 감싸 새 행만 렌더되게 한다. hex는 같은 행 오른쪽에 필드 경계로 묶어 보이고,
// 필드 셀 ↔ 바이트 묶음 hover를 행 단위 state 하나로 서로 강조한다(M12).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { resolvePad } from '@/domain/kit/calibration/calibration';
import { arrivalLevel, negate as neg } from '@/features/monitor/core/health';
import { agreeRate, edgeDeg, edgeTone, hitPose, insideRate } from '@/features/monitor/core/boundary';
import type { LogRow } from '@/features/monitor/core/recording/packetLog';
import { hexGroups, hexSpaced, type HitFieldKey } from './hitFields';
import { cssVar, fmt, prepareCanvas, stickName, type Snap } from './monitorTypes';

const MAX_ROWS = 200;
const CHART_HITS = 60;
/** margin과 −edge가 이 값(도)을 넘게 다르면 mon-mismatch */
const MISMATCH_DEG = 3;

/** 표에 올릴 행. interval은 같은 스틱 직전 HIT와 tBrowser 차 */
interface ViewRow {
  row: LogRow;
  interval: number | null;
}

/** 버퍼에서 HIT·error·drop 행만 골라 최근 MAX_ROWS건을 최신 먼저로 만든다 */
function pickRows(rows: readonly LogRow[]): ViewRow[] {
  const out: ViewRow[] = [];
  // 오래된 → 최신으로 훑으며 interval을 계산하고, 마지막에 뒤집는다
  const lastT: [number | null, number | null] = [null, null];
  for (const r of rows) {
    if (r.dir !== 'in' || !r.decoded) continue;
    const d = r.decoded;
    if (d.kind === 'hit') {
      let interval: number | null = null;
      if (r.stick !== null) {
        const prev = lastT[r.stick];
        if (r.tBrowser !== null && prev !== null) interval = r.tBrowser - prev;
        lastT[r.stick] = r.tBrowser;
      }
      out.push({ row: r, interval });
    } else if (d.kind === 'error' || (d.kind === 'log' && r.log?.kind === 'drop')) {
      out.push({ row: r, interval: null });
    }
  }
  return out.slice(-MAX_ROWS).reverse();
}

const COLS: string[] = [
  't(ms)',
  '손',
  'seq',
  'timestampUs',
  'tBrowser',
  '도착(수신−정지)',
  'pad(fw)',
  'fePad',
  'agree',
  'edge',
  'margin',
  'elev',
  'azim',
  'peakSpeed',
  'vel',
  'swingMs',
  'lateral',
  'decel',
  'flags',
  'interval',
  'hex (필드별)',
];

interface RowProps {
  vr: ViewRow;
  profile: CalibrationProfile | null;
  /** 행 클릭 콜백(원시 파형 탭 이동·타격 추적 선택용, t = 행 수신 시각). 안정된 참조로 넘기므로 memo 비교에서 제외한다 */
  onSelectHit?: (stick: 0 | 1, seq: number, t: number) => void;
  /** 다른 탭(세기 산점)에서 고른 행. 강조하고 화면 안으로 스크롤한다 */
  selected?: boolean;
}

const HitRowView = memo(function HitRowView({ vr, profile, onSelectHit, selected }: RowProps) {
  const [hovered, setHovered] = useState<HitFieldKey | null>(null);
  const trRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (selected) trRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);
  const { row, interval } = vr;
  const d = row.decoded;
  const handColor = row.stick === null ? undefined : row.stick === 0 ? 'var(--left)' : 'var(--right)';

  if (d?.kind === 'error') {
    return (
      <tr className="mon-row-error">
        <td className="num">{fmt(row.t)}</td>
        <td style={{ color: handColor }}>{stickName(row.stick)}</td>
        <td colSpan={COLS.length - 3}>
          오류 {d.reason === 'short' ? '길이 부족' : '알 수 없는 타입'} · type {d.type === null ? '–' : `0x${d.type.toString(16)}`} ·{' '}
          {d.bytes.length}B
        </td>
        <td className="mono">{hexSpaced(d.bytes)}</td>
      </tr>
    );
  }
  if (d?.kind === 'log') {
    const p = row.log;
    return (
      <tr className="mon-row-drop">
        <td className="num">{fmt(row.t)}</td>
        <td style={{ color: handColor }}>{stickName(row.stick)}</td>
        <td colSpan={COLS.length - 2}>거른 스윙 · {p?.kind === 'drop' ? `${p.reason} · ${p.dps} dps` : d.text}</td>
      </tr>
    );
  }
  if (d?.kind !== 'hit') return null;

  const fe = resolvePad(profile, hitPose(d))?.pad ?? null;
  const edge = edgeDeg(profile, hitPose(d))?.edgeDeg ?? null;
  // 펌웨어 margin은 경계까지 남은 여유(안쪽 +)로 FE edge의 부호를 뒤집은 값과 같아야 한다.
  // 부호가 어긋나거나 |margin − (−edge)|가 3°를 넘으면 판정 기준 불일치 후보로 강조한다.
  const mismatch = edge !== null && Math.abs(d.marginDeg + edge) > MISMATCH_DEG;
  const agree = fe === null ? null : fe === d.pad;
  const cell = (key: HitFieldKey, content: React.ReactNode) => (
    <td
      className={`num raw${hovered === key ? ' hl' : ''}`}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
    >
      {content}
    </td>
  );
  const groups = hexGroups(row.bytes);

  const stick = row.stick;
  // 도착(수신−정지) = −futureMs. 상태 기준은 ③ 시계 단계와 같다(health.arrivalLevel)
  const arrival = neg(row.futureMs);
  const arrLevel = arrivalLevel(arrival, arrival).level;
  const arrivalTone = arrLevel === 'warn' || arrLevel === 'bad' ? ` ${arrLevel}` : '';
  return (
    <tr
      ref={trRef}
      className={[onSelectHit && stick !== null ? 'clickable' : '', selected ? 'selected' : ''].filter(Boolean).join(' ') || undefined}
      onClick={onSelectHit && stick !== null ? () => onSelectHit(stick, d.seq, row.t) : undefined}
    >
      <td className="num">{fmt(row.t)}</td>
      <td style={{ color: handColor, fontWeight: 700 }}>{stickName(row.stick)}</td>
      {cell('seq', d.seq)}
      {cell('ts', d.timestampUs)}
      <td className="num derived">{fmt(row.tBrowser)}</td>
      <td className={`num derived${arrivalTone}`}>{fmt(arrival)}</td>
      {cell('pad', d.pad ?? '없음')}
      <td className="derived">{fe ?? '–'}</td>
      <td className={`derived ${agree === null ? '' : agree ? 'ok' : 'bad'}`}>{agree === null ? '–' : agree ? '✓' : '✗'}</td>
      <td className={`num derived${edge === null ? '' : ` edge-${edgeTone(edge)}`}`}>
        {edge === null ? '–' : `${edge > 0 ? '+' : ''}${edge.toFixed(1)}`}
      </td>
      <td
        className={`num raw${mismatch ? ' mon-mismatch' : ''}${hovered === 'margin' ? ' hl' : ''}`}
        onMouseEnter={() => setHovered('margin')}
        onMouseLeave={() => setHovered(null)}
      >
        {fmt(d.marginDeg)}
      </td>
      {cell('elev', fmt(d.elevationDeg, 2))}
      {cell('azim', fmt(d.azimuthDeg, 2))}
      {cell('peak', d.peakSpeedDps)}
      {cell('vel', d.velocity)}
      {cell('swing', d.swingMs)}
      {cell('lat', fmt(d.lateralDeg))}
      {cell('decel', fmt(d.decel))}
      {cell(
        'flags',
        <>
          {d.magAnomaly && (
            <span className="badge warn" title="지자기 이상">
              MAG
            </span>
          )}
          {d.ambiguous && (
            <span className="badge warn" title="판정 애매">
              AMB
            </span>
          )}
          {!d.magAnomaly && !d.ambiguous && '·'}
        </>,
      )}
      <td className="num derived">{fmt(interval, 0)}</td>
      <td className="mono hexcell">
        {groups.map((g) => (
          <span
            key={g.key}
            data-field={g.key}
            className={`hexg${hovered === g.key ? ' hl' : ''}`}
            title={`[${g.start}${g.end - g.start > 1 ? `..${g.end - 1}` : ''}] ${g.key}`}
            onMouseEnter={() => setHovered(g.key)}
            onMouseLeave={() => setHovered(null)}
          >
            {g.hex}
          </span>
        ))}
      </td>
    </tr>
  );
}, sameRow);

/** ViewRow는 매번 새로 만들어지므로, 행 객체·interval·프로필이 같으면 같은 행으로 본다 */
function sameRow(a: RowProps, b: RowProps): boolean {
  return a.vr.row === b.vr.row && a.vr.interval === b.vr.interval && a.profile === b.profile;
}

/** 최근 60 HIT의 peakSpeed·decel·velocity 정규화 선 차트. 100ms 스냅샷 갱신 때만 다시 그린다 */
function HitStrip({ rows, tick }: { rows: readonly LogRow[]; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const hits: { peak: number; decel: number; vel: number }[] = [];
    for (let i = rows.length - 1; i >= 0 && hits.length < CHART_HITS; i--) {
      const d = rows[i].decoded;
      if (rows[i].dir === 'in' && d?.kind === 'hit') hits.push({ peak: d.peakSpeedDps, decel: d.decel, vel: d.velocity });
    }
    hits.reverse();
    ctx.strokeStyle = cssVar(el, '--line', '#34405c');
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    if (hits.length < 2) return;
    const series: { key: 'peak' | 'decel' | 'vel'; color: string }[] = [
      { key: 'peak', color: cssVar(el, '--brand', '#e6b85c') },
      { key: 'decel', color: cssVar(el, '--miss', '#e05a5a') },
      { key: 'vel', color: cssVar(el, '--good', '#5fb8ae') },
    ];
    for (const s of series) {
      const max = Math.max(1, ...hits.map((x) => x[s.key]));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hits.forEach((x, i) => {
        const px = (i / (CHART_HITS - 1)) * w;
        const py = h - 6 - (x[s.key] / max) * (h - 12);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, [rows, tick]);
  return <canvas ref={ref} className="mon-strip" />;
}

export const HitTable = memo(function HitTable({
  snap,
  profile,
  onSelectHit,
  selected,
}: {
  snap: Snap;
  profile: CalibrationProfile | null;
  onSelectHit?: (stick: 0 | 1, seq: number, t: number) => void;
  /** 세기 산점에서 고른 HIT(스틱·seq). 같은 행을 강조·스크롤한다 */
  selected?: { stick: 0 | 1; seq: number } | null;
}) {
  const view = useMemo(() => pickRows(snap.rows), [snap.rows]);
  const inRate = useMemo(() => insideRate(snap.rows, profile), [snap.rows, profile]);
  const agRate = useMemo(() => agreeRate(snap.rows, profile), [snap.rows, profile]);
  const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
  const [f0, f1] = snap.stats.perStick.map((s) => s.hitFuture);
  return (
    <div className="mon-hit">
      <div className="mon-summary-line">
        도착(수신−정지, 최근 50건) · L 중앙값 {fmt(neg(f0.median))}ms 최대 {fmt(neg(f0.min))}ms · R 중앙값 {fmt(neg(f1.median))}ms 최대{' '}
        {fmt(neg(f1.min))}ms
        <span className="faint"> (음수 = 정지 시각보다 먼저 도착, 정상 −11 ~ 0, 시계 동기화 전이면 –)</span>
      </div>
      <div className="mon-summary-line">
        바운더리 안 {pct(inRate)} · agree {pct(agRate)}
        <span className="faint"> (최근 50건, FE 프로필 기준)</span>
      </div>
      <div className="faint small">
        차트: peakSpeed(황동) · decel(빨강) · velocity(청록), 각 선은 자기 최댓값으로 정규화 · 표: 파란 글자 = 원시값, 회색 글자 = 파생값 ·
        필드 셀과 hex 묶음에 마우스를 올리면 서로 강조됩니다
      </div>
      <HitStrip rows={snap.rows} tick={snap.tick} />
      <div className="mon-table-wrap">
        <table className="mon-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((vr) => (
              <HitRowView
                key={vr.row.id}
                vr={vr}
                profile={profile}
                onSelectHit={onSelectHit}
                selected={
                  !!selected &&
                  vr.row.stick === selected.stick &&
                  vr.row.decoded?.kind === 'hit' &&
                  vr.row.decoded.seq === selected.seq
                }
              />
            ))}
          </tbody>
        </table>
        {view.length === 0 && <p className="faint mon-empty">HIT가 아직 없습니다. 모의 스틱을 켜거나 스틱을 치세요.</p>}
      </div>
    </div>
  );
});
