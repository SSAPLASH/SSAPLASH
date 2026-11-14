// ② 멀어질 방향 안내 그림(PLAY-004 v0.4 D17): 가까웠던 이웃 패드가 한 번 빛나고, 칠 자리 윤곽이 이웃 반대쪽으로 스프링으로 미끄러져 나간다.
// 방향은 드럼 그림에서 이웃 패드 → 칠 패드(U6: 그림 기준이라 쌍별 문구와 어긋나지 않는다). 킷 상자 좌표의 SVG 조각이다. 움직임은 hint.css.
import type { CSSProperties } from 'react';
import { awayVector, ringEdge, type PadRing } from './hintGeometry';

/** 윤곽이 밀려나는 거리(링 짧은 반지름 대비) */
const NUDGE = 0.42;

export function MoveAwayHint({ ring, near }: { ring: PadRing; near: PadRing }) {
  const { ux, uy } = awayVector(near, ring);
  const d = Math.min(ring.rx, ring.ry) * NUDGE;
  const edge = ringEdge(ring, ux, uy);
  const nearEdge = ringEdge(near, ux, uy);
  const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
  // 두 링 사이에 틈이 있을 때만 잇는 선을 그린다
  const gap = Math.hypot(ring.cx - near.cx, ring.cy - near.cy) - edge - nearEdge;
  const nudge = { '--dx': `${ux * d}px`, '--dy': `${uy * d}px` } as CSSProperties;
  return (
    <g data-testid="cal-hint-away">
      <defs>
        <linearGradient id="cal-hint-tether" gradientUnits="userSpaceOnUse" x1={near.cx} y1={near.cy} x2={ring.cx} y2={ring.cy}>
          <stop offset="0" stopColor="var(--warn)" />
          <stop offset="1" stopColor="var(--warn)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse className="cal-hint-halo" cx={near.cx} cy={near.cy} rx={near.rx + 3} ry={near.ry + 3} />
      {gap > 4 && (
        <line className="cal-hint-tether" x1={near.cx + ux * nearEdge} y1={near.cy + uy * nearEdge} x2={ring.cx - ux * edge} y2={ring.cy - uy * edge} />
      )}
      <g className="cal-hint-nudge" style={nudge}>
        <ellipse className="cal-hint-ring" cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} />
        <path className="cal-hint-head" d="M-6 -9 L5 0 L-6 9" transform={`translate(${ring.cx + ux * (edge + 16)} ${ring.cy + uy * (edge + 16)}) rotate(${deg})`} />
      </g>
    </g>
  );
}
