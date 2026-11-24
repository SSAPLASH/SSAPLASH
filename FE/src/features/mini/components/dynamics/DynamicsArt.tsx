// 「강약중강약」의 그림 (Figma glyph / 큰 원·작은 원·중간 원). 세기가 다른 세 타를 원의 크기로 보인다. 아래 끝을 맞춰 놓는다.
// 장식이라 화면 낭독기에서 숨긴다. 스타일은 목록도 쓰므로 공용 mini.css의 「그림」 절에 있다.

/** 원 세 개(강·약·중). 중심 x·반지름. 아래 끝은 y=110에 맞춘다 */
const DOTS = [
  { level: 'strong', cx: 50, r: 50 },
  { level: 'weak', cx: 142, r: 20 },
  { level: 'mid', cx: 220, r: 34 },
] as const;
const BASELINE = 110;

interface Props {
  size?: 'card' | 'hero';
}

export function DynamicsArt({ size = 'card' }: Props) {
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {DOTS.map((dot) => (
        <circle key={dot.level} cx={dot.cx} cy={BASELINE - dot.r} r={dot.r} className={`mini-art-dot is-${dot.level}`} />
      ))}
    </svg>
  );
}
