// 「인간 메트로놈」의 그림 (Figma glyph / 켜진 박 넷과 꺼진 박 넷). 소리가 들리는 박과 소리가 꺼진 뒤의 박을 점으로 보인다.
// 장식이라 화면 낭독기에서 숨긴다. 스타일은 목록도 쓰므로 공용 mini.css의 「그림」 절에 있다.

/** 점 여덟 개. 앞의 넷은 켜진 박, 뒤의 넷은 꺼진 박 */
const BEATS = 8;
const ON_BEATS = 4;
const RADIUS = 13;
const GAP = 40;
const FIRST_X = 20;

interface Props {
  size?: 'card' | 'hero';
}

export function TempoArt({ size = 'card' }: Props) {
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: BEATS }, (_, i) => (
        <circle key={i} cx={FIRST_X + GAP * i} cy={60} r={RADIUS} className={i < ON_BEATS ? 'mini-art-beat is-on' : 'mini-art-beat is-off'} />
      ))}
    </svg>
  );
}
