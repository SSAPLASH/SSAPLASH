// 「악보 보고 빨리 치기」의 그림 (Figma glyph / 오선과 파란 음표). 오선 다섯 줄 위에 음표 하나.
// 장식이라 화면 낭독기에서 숨긴다. 스타일은 목록도 쓰므로 공용 mini.css의 「그림」 절에 있다.

/** 오선 다섯 줄의 y. 줄 간격 20 */
const LINES = [20, 40, 60, 80, 100] as const;
/** 음표 머리 중심과 기둥 끝 */
const HEAD = { cx: 150, cy: 70, rx: 15, ry: 11 };
const STEM_TOP = 6;

interface Props {
  size?: 'card' | 'hero';
}

export function SightArt({ size = 'card' }: Props) {
  const stemX = HEAD.cx + HEAD.rx - 2;
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {LINES.map((y) => (
        <line key={y} x1={0} x2={300} y1={y} y2={y} className="mini-art-staff" />
      ))}
      <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} transform={`rotate(-20 ${HEAD.cx} ${HEAD.cy})`} className="mini-art-note" />
      <line x1={stemX} x2={stemX} y1={HEAD.cy - 4} y2={STEM_TOP} className="mini-art-stem" />
    </svg>
  );
}
