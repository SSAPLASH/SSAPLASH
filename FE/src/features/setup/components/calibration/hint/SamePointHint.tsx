// ① 같은 지점 안내 그림(PLAY-004 v0.4 D16): 패드 위에서 빛 알갱이 둘이 스프링으로 끌려와 하나로 합쳐지고 물결이 두 번 번진다.
// 킷 상자 좌표의 SVG 조각이다(CaptureHint의 svg 안에 넣는다). 움직임은 hint.css.
import type { CSSProperties } from 'react';
import type { PadRing } from './hintGeometry';

export function SamePointHint({ ring }: { ring: PadRing }) {
  const r = Math.min(ring.rx, ring.ry);
  const a = { '--ox': `${-0.5 * r}px`, '--oy': `${-0.22 * r}px` } as CSSProperties;
  const b = { '--ox': `${0.52 * r}px`, '--oy': `${0.26 * r}px` } as CSSProperties;
  return (
    <g transform={`translate(${ring.cx} ${ring.cy})`} data-testid="cal-hint-same">
      <defs>
        <radialGradient id="cal-hint-orb">
          <stop offset="0" stopColor="#dff5ff" />
          <stop offset="0.35" stopColor="var(--brand-text)" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="cal-hint-ripple" r={r * 0.3} />
      <circle className="cal-hint-ripple late" r={r * 0.3} />
      <circle className="cal-hint-orb" r={r * 0.3} style={a} />
      <circle className="cal-hint-orb" r={r * 0.3} style={b} />
      <circle className="cal-hint-core" r={r * 0.38} />
    </g>
  );
}
