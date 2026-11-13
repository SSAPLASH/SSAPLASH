// 자세 평면: 가로 yaw, 세로 pitch에 패드 원·현재 자세·최근 궤적·HIT 마커를 겹쳐 그린다(설계 3-8 a).
// 축 방향은 kitMapping.poseToScreen과 같다 — x = 중앙 + yaw(오른쪽이 +), y = 중앙 − pitch(위가 +).
// 가로·세로 스케일이 다르면 원이 타원이 되므로, 두 축 모두 범위가 넓은 쪽 기준의 같은 px/°를 쓴다.
// 그래서 정사각 캔버스의 보이는 범위는 ±max(yawDeg, pitchDeg)이고, 실제 입력 범위(±yawDeg × ±pitchDeg)는 점선 사각형으로 표시한다.
import { memo, useEffect, useRef, useState } from 'react';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import type { AngleRange } from '@/domain/kit/kitMapping';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/kit/pads';
import type { DecodedHit, PadTableEntry } from '@/input/stickProtocol';
import { edgeDeg, edgeTone, hitPose, type EdgeResult } from '@/features/monitor/core/boundary';
import type { LogRow } from '@/features/monitor/core/recording/packetLog';
import { cssVar, fmt, prepareCanvas, stickName, type Snap } from './monitorTypes';

const GRID_DEG = 10;
const TRAIL_MS = 1000;
const TRAIL_MAX = 100;
const HIT_MS = 3000;
const HOVER_MARGIN_DEG = 3;
const GRAY = '#8a93a8';
/** 스틱 표와 프로필 앵커가 이만큼(°) 넘게 다르면 불일치 */
const TABLE_DIFF_DEG = 0.5;

interface PosePt {
  t: number;
  pitch: number;
  yaw: number;
}

/** 스틱별 마지막 POSE와 최근 1초 궤적(오래된 → 최신, 최대 TRAIL_MAX점) */
function collectSticks(rows: readonly LogRow[], now: number): { last: (PosePt | null)[]; trail: PosePt[][] } {
  const last: (PosePt | null)[] = [null, null];
  const trail: PosePt[][] = [[], []];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const d = r.decoded;
    if (r.dir !== 'in' || d?.kind !== 'pose' || r.stick === null) continue;
    const p = { t: r.t, pitch: d.elevationDeg, yaw: d.azimuthDeg };
    if (!last[r.stick]) last[r.stick] = p;
    if (r.t >= now - TRAIL_MS) {
      if (trail[r.stick].length < TRAIL_MAX) trail[r.stick].push(p);
    } else if (last[0] && last[1]) break;
  }
  trail[0].reverse();
  trail[1].reverse();
  return { last, trail };
}

interface HitInfo {
  t: number;
  stick: 0 | 1 | null;
  d: DecodedHit;
}

/** 3초 창 HIT(오래된 → 최신)와 버퍼 전체에서 마지막 HIT */
function collectHits(rows: readonly LogRow[], now: number): { recent: HitInfo[]; last: HitInfo | null } {
  const recent: HitInfo[] = [];
  let last: HitInfo | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const d = r.decoded;
    if (r.dir !== 'in' || d?.kind !== 'hit') continue;
    const info = { t: r.t, stick: r.stick, d };
    if (!last) last = info;
    if (r.t < now - HIT_MS) break;
    recent.push(info);
  }
  return { recent: recent.reverse(), last };
}

const sign = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
const TONE_VAR = {
  inside: '--good',
  near: '--perfect',
  outside: '--miss',
} as const;

/** "안쪽 −3.2°" / "바깥 +1.8°" 표기. 색은 edgeTone */
function EdgeText({ e }: { e: EdgeResult | null }) {
  if (!e) return <span className="faint">–</span>;
  return (
    <span style={{ color: `var(${TONE_VAR[edgeTone(e.edgeDeg)]})` }}>
      {e.edgeDeg <= 0 ? '안쪽' : '바깥'} {sign(e.edgeDeg)}°
    </span>
  );
}

/** 스틱 패드 표 중 같은 pad의 프로필 앵커와 중심 거리나 반경 차가 TABLE_DIFF_DEG를 넘는 패드들 */
function tableMismatches(table: readonly PadTableEntry[], profile: CalibrationProfile | null): PadId[] {
  if (!profile) return [];
  const out: PadId[] = [];
  for (const e of table) {
    const a = profile.anchors[e.pad];
    if (!a) continue;
    const dist = Math.hypot(e.elevationDeg - a.pitch, e.azimuthDeg - a.yaw);
    if (dist > TABLE_DIFF_DEG || Math.abs(e.radiusDeg - a.radius) > TABLE_DIFF_DEG) out.push(e.pad);
  }
  return out;
}

interface Tip {
  x: number;
  y: number;
  text: string;
}

export const PosePlane = memo(function PosePlane({
  snap,
  profile,
  angleRange,
}: {
  snap: Snap;
  profile: CalibrationProfile | null;
  angleRange: AngleRange;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const span = Math.max(angleRange.yawDeg, angleRange.pitchDeg);

  // Snap이 바뀔 때(100ms)만 rAF 한 번으로 다시 그린다
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      const c = prepareCanvas(el);
      if (!c || !el) return;
      const { ctx, w } = c;
      const s = w / (2 * span);
      const gx = (yaw: number) => w / 2 + yaw * s;
      const gy = (pitch: number) => w / 2 - pitch * s;
      const line = cssVar(el, '--line', '#34405c');
      const faint = cssVar(el, '--text-3', '#6e778d');
      const ink = cssVar(el, '--text-1', '#e8e4da');
      const stickColor = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--right', '#ffa07c')];

      // 격자(10° 간격, 희미하게)와 0° 축선
      ctx.lineWidth = 1;
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (let d = GRID_DEG; d <= span; d += GRID_DEG) {
        for (const sgn of [-1, 1]) {
          ctx.moveTo(gx(sgn * d), 0);
          ctx.lineTo(gx(sgn * d), w);
          ctx.moveTo(0, gy(sgn * d));
          ctx.lineTo(w, gy(sgn * d));
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(gx(0), 0);
      ctx.lineTo(gx(0), w);
      ctx.moveTo(0, gy(0));
      ctx.lineTo(w, gy(0));
      ctx.stroke();
      // 입력 각도 범위(±yawDeg × ±pitchDeg)
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(gx(-angleRange.yawDeg), gy(angleRange.pitchDeg), 2 * angleRange.yawDeg * s, 2 * angleRange.pitchDeg * s);
      ctx.setLineDash([]);
      ctx.font = '10px monospace';
      ctx.fillStyle = faint;
      ctx.fillText(`yaw ±${angleRange.yawDeg}°`, 6, w - 6);
      ctx.fillText(`pitch ±${angleRange.pitchDeg}°`, 6, 12);

      // 패드 원: 채움 알파 0.12, 테두리 실선, 짧은 이름 라벨
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      if (profile) {
        for (const pad of STICK_PADS) {
          const a = profile.anchors[pad];
          if (!a) continue;
          const color = PAD_META[pad].color;
          ctx.beginPath();
          ctx.arc(gx(a.yaw), gy(a.pitch), a.radius * s, 0, Math.PI * 2);
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillText(PAD_META[pad].short, gx(a.yaw), gy(a.pitch) + 4);
        }
      }
      ctx.textAlign = 'start';

      // 스틱 패드 표(FE가 보낸 SET_PAD_TABLE을 되읽은 값): 점선 원. 프로필 실선 원과 어긋나면 스틱이 다른 표를 쓴다는 뜻
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.85;
      for (const e of snap.stats.padTable.entries) {
        ctx.strokeStyle = PAD_META[e.pad].color;
        ctx.beginPath();
        ctx.arc(gx(e.azimuthDeg), gy(e.elevationDeg), e.radiusDeg * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // HIT 마커(3초). 펌웨어 pad와 FE 최근접 패드가 다르면 FE 패드 중심까지 점선
      for (const { t, d } of collectHits(snap.rows, snap.now).recent) {
        const px = gx(d.azimuthDeg);
        const py = gy(d.elevationDeg);
        const col = d.pad ? PAD_META[d.pad].color : GRAY;
        ctx.globalAlpha = Math.max(0.2, 1 - ((snap.now - t) / HIT_MS) * 0.7);
        const e = edgeDeg(profile, hitPose(d));
        const fa = e && d.pad && e.pad !== d.pad ? profile?.anchors[e.pad] : undefined;
        if (fa) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(gx(fa.yaw), gy(fa.pitch));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      }

      // 현재 자세 점 + 최근 1초 궤적(오래될수록 옅게)
      const { last, trail } = collectSticks(snap.rows, snap.now);
      for (const stick of [0, 1] as const) {
        const pts = trail[stick];
        ctx.strokeStyle = stickColor[stick];
        ctx.lineWidth = 1.5;
        for (let i = 1; i < pts.length; i++) {
          ctx.globalAlpha = 0.1 + 0.6 * (i / pts.length);
          ctx.beginPath();
          ctx.moveTo(gx(pts[i - 1].yaw), gy(pts[i - 1].pitch));
          ctx.lineTo(gx(pts[i].yaw), gy(pts[i].pitch));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        const p = last[stick];
        if (p) {
          ctx.beginPath();
          ctx.arc(gx(p.yaw), gy(p.pitch), 5, 0, Math.PI * 2);
          ctx.fillStyle = stickColor[stick];
          ctx.fill();
          ctx.strokeStyle = ink;
          ctx.stroke();
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [snap, profile, angleRange, span]);

  // 호버: 캔버스 좌표 → 각도 역변환, 반경 + 3° 안에서 가장 가까운 패드 원
  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const el = ref.current;
    if (!el || !profile) return;
    const rect = el.getBoundingClientRect();
    const s = rect.width / (2 * span);
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const yaw = (cx - rect.width / 2) / s;
    const pitch = -(cy - rect.height / 2) / s;
    let best: { pad: PadId; d: number } | null = null;
    for (const pad of STICK_PADS) {
      const a = profile.anchors[pad];
      if (!a) continue;
      const d = Math.hypot(pitch - a.pitch, yaw - a.yaw);
      if (d <= a.radius + HOVER_MARGIN_DEG && (!best || d < best.d)) best = { pad, d };
    }
    const a = best ? profile.anchors[best.pad] : null;
    if (!best || !a) {
      setTip(null);
      return;
    }
    const cur = collectSticks(snap.rows, snap.now)
      .last.map((p, i) =>
        p ? `현재 ${stickName(i as 0 | 1)}과 거리 ${Math.hypot(p.pitch - a.pitch, p.yaw - a.yaw).toFixed(1)}°` : null,
      )
      .filter((x) => x !== null)
      .join(' · ');
    const st = snap.stats.padTable.entries.find((e) => e.pad === best.pad);
    const stickTable = st ? ` · 스틱 표: 중심 (${fmt(st.azimuthDeg)}°, ${fmt(st.elevationDeg)}°) 반경 ${fmt(st.radiusDeg)}°` : '';
    setTip({
      x: cx,
      y: cy,
      text: `${best.pad} 중심 (${fmt(a.yaw)}°, ${fmt(a.pitch)}°) 반경 ${fmt(a.radius)}°${cur ? ` · ${cur}` : ''}${stickTable}`,
    });
  };

  const poses = collectSticks(snap.rows, snap.now).last;
  const lastHit = collectHits(snap.rows, snap.now).last;
  const table = snap.stats.padTable.entries;
  const mismatch = tableMismatches(table, profile);
  const hitEdge = lastHit ? edgeDeg(profile, hitPose(lastHit.d)) : null;

  return (
    <div className="mon-plane">
      <div className="mon-plane-canvas">
        <canvas ref={ref} className="mon-plane-cv" onMouseMove={onMove} onMouseLeave={() => setTip(null)} />
        {tip && (
          <div className="mon-plane-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="mon-plane-info small">
        {([0, 1] as const).map((st) => {
          const p = poses[st];
          const e = p ? edgeDeg(profile, p) : null;
          return (
            <div key={st}>
              <strong style={{ color: st === 0 ? 'var(--left)' : 'var(--right)' }}>{stickName(st)}</strong> 현재 자세:{' '}
              {e ? (
                <>
                  패드 {e.pad}, <EdgeText e={e} />
                </>
              ) : (
                <span className="faint">–</span>
              )}
            </div>
          );
        })}
        <div>
          마지막 HIT:{' '}
          {lastHit ? (
            <>
              {stickName(lastHit.stick)} · pad(펌웨어) {lastHit.d.pad ?? '없음'} / FE 패드 {hitEdge?.pad ?? '–'} / 바운더리{' '}
              <EdgeText e={hitEdge} /> / margin {fmt(lastHit.d.marginDeg)}°
            </>
          ) : (
            <span className="faint">–</span>
          )}
        </div>
        <div className={mismatch.length > 0 ? 'warn' : undefined}>
          스틱 패드 표:{' '}
          {table.length === 0 ? (
            <span className="faint">보낸 적 없음</span>
          ) : (
            <>
              {table.length}개 · 프로필과 다름 {mismatch.length}개{mismatch.length > 0 ? ` (${mismatch.join(', ')})` : ''}
            </>
          )}
        </div>
        <div className="faint">점선 원 = 스틱에 보낸 패드 표 · 실선 원 = FE 프로필</div>
        <div className="faint">× = HIT(3초, 펌웨어 pad 색) · 점선 = FE와 펌웨어 패드가 다를 때 FE 패드 중심으로</div>
      </div>
    </div>
  );
});
