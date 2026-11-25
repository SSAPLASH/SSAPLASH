// 「정적 뒤 한 방」의 그림 (Figma glyph / 노래 막대 · 정적 · 한 방). 왼쪽의 막대가 노래, 가운데 점선이 정적, 오른쪽 굵은 막대가 한 방이다.
// 장식이라 화면 낭독기에서 숨긴다. 스타일은 목록도 쓰므로 공용 mini.css의 「그림」 절에 있다.

/** 노래 막대의 높이. 가운데(y=60)에 맞춰 놓는다 */
const SONG_BARS = [34, 62, 46, 78, 54, 30] as const;
const BAR_W = 9;
const BAR_GAP = 20;
/** 정적 점선의 양 끝 x */
const REST_FROM = 130;
const REST_TO = 268;
const SHOT_X = 286;

interface Props {
  size?: 'card' | 'hero';
}

export function OneShotArt({ size = 'card' }: Props) {
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {SONG_BARS.map((h, i) => (
        <rect key={i} x={i * BAR_GAP} y={60 - h / 2} width={BAR_W} height={h} rx={BAR_W / 2} className="mini-art-song" />
      ))}
      <line x1={REST_FROM} x2={REST_TO} y1={60} y2={60} className="mini-art-rest" />
      <rect x={SHOT_X} y={10} width={12} height={100} rx={6} className="mini-art-shot" />
    </svg>
  );
}
