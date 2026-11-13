// POSE 탭: 왼쪽 최근 10초 고도각·방위각 시계열(스틱별 색) + 요약, 오른쪽 자세 평면(PosePlane).
import { memo, useEffect, useRef } from 'react';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import type { AngleRange } from '@/domain/kit/kitMapping';
import type { LogRow } from '@/features/monitor/core/recording/packetLog';
import { cssVar, fmt, prepareCanvas, type Snap } from './monitorTypes';
import { PosePlane } from './PosePlane';

const SPAN_MS = 10_000;
const ELEV_RANGE = 90;
const AZIM_RANGE = 180;

interface PosePoint {
  t: number;
  elev: number;
  azim: number;
  roll: number;
  stick: 0 | 1;
}

/** 버퍼 끝에서부터 SPAN_MS 안의 POSE를 모은다(오래된 → 최신) */
function collectPose(rows: readonly LogRow[], now: number): PosePoint[] {
  const out: PosePoint[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.t < now - SPAN_MS) break;
    const d = r.decoded;
    if (r.dir === 'in' && d?.kind === 'pose' && r.stick !== null) {
      out.push({ t: r.t, elev: d.elevationDeg, azim: d.azimuthDeg, roll: d.rollDeg, stick: r.stick });
    }
  }
  return out.reverse();
}

export const PoseScope = memo(function PoseScope({
  snap,
  profile,
  angleRange,
}: {
  snap: Snap;
  profile: CalibrationProfile | null;
  angleRange: AngleRange;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const pts = collectPose(snap.rows, snap.now);
    const colors = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--right', '#ffa07c')];
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');

    // 위 절반 = 고도각, 아래 절반 = 방위각
    const half = h / 2;
    const panels = [
      { key: 'elev' as const, range: ELEV_RANGE, top: 0, label: '고도각 ±90°' },
      { key: 'azim' as const, range: AZIM_RANGE, top: half, label: '방위각 ±180°' },
    ];
    ctx.font = '11px monospace';
    for (const p of panels) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, p.top + 0.5, w - 1, half - 1);
      ctx.beginPath();
      ctx.moveTo(0, p.top + half / 2);
      ctx.lineTo(w, p.top + half / 2);
      ctx.stroke();
      ctx.fillStyle = faint;
      ctx.fillText(p.label, 6, p.top + 13);
      for (const stick of [0, 1] as const) {
        ctx.strokeStyle = colors[stick];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (const pt of pts) {
          if (pt.stick !== stick) continue;
          const x = ((pt.t - (snap.now - SPAN_MS)) / SPAN_MS) * w;
          const y = p.top + half / 2 - (pt[p.key] / p.range) * (half / 2 - 2);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }, [snap]);

  const sticks = snap.stats.perStick;
  const lastPose = (stick: 0 | 1): LogRow | undefined => {
    for (let i = snap.rows.length - 1; i >= 0; i--) {
      const r = snap.rows[i];
      if (r.dir === 'in' && r.stick === stick && r.decoded?.kind === 'pose') return r;
    }
    return undefined;
  };

  return (
    <div className="mon-pose-grid">
      <div className="mon-pose">
        <div className="mon-summary-line">
          POSE {snap.stats.ratePerType.pose ?? 0}/s(두 스틱 합) · 최근 10초 · <span style={{ color: 'var(--left)' }}>L 파랑</span>{' '}
          / <span style={{ color: 'var(--right)' }}>R 주황</span>
        </div>
        <canvas ref={ref} className="mon-strip tall" />
        <table className="mon-table">
          <thead>
            <tr>
              <th>손</th>
              <th>유실률(1초)</th>
              <th>유실 누적</th>
              <th>elev</th>
              <th>azim</th>
              <th>roll</th>
            </tr>
          </thead>
          <tbody>
            {([0, 1] as const).map((s) => {
              const last = lastPose(s)?.decoded;
              const pose = last?.kind === 'pose' ? last : null;
              const loss = sticks[s].poseSeqLoss;
              return (
                <tr key={s}>
                  <td style={{ color: s === 0 ? 'var(--left)' : 'var(--right)', fontWeight: 700 }}>{s === 0 ? 'L' : 'R'}</td>
                  <td className="num">{loss.pct === null ? '–' : `${loss.pct.toFixed(1)}%`}</td>
                  <td className="num">{loss.total}</td>
                  <td className="num">{fmt(pose?.elevationDeg, 2)}</td>
                  <td className="num">{fmt(pose?.azimuthDeg, 2)}</td>
                  <td className="num">{fmt(pose?.rollDeg, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="faint small">12바이트(v0.5) POSE는 seq가 없어 유실률이 –로 표시됩니다.</p>
      </div>
      <PosePlane snap={snap} profile={profile} angleRange={angleRange} />
    </div>
  );
});
