// 「어디까지 올라가는 거예요?」의 그림 (설계 MODE-006-minigame-crescendo). 왼쪽에서 오른쪽으로 점점 커지는 원 넷을 아래 끝을 맞춰 놓는다. 가장 큰 원만 강조색이다.
// 장식이라 화면 낭독기에서 숨긴다. 스타일은 목록도 쓰므로 공용 mini.css의 「그림」 절에 있다.

/** 원 넷. 중심 x·반지름. 아래 끝은 y=110에 맞춘다 */
const DOTS = [
  { cx: 40, r: 10 },
  { cx: 120, r: 20 },
  { cx: 205, r: 32 },
  { cx: 290, r: 44 },
] as const;
const BASELINE = 110;

interface Props {
  size?: 'card' | 'hero';
}

export function CrescendoArt({ size = 'card' }: Props) {
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {DOTS.map((dot, i) => (
        <circle
          key={dot.cx}
          cx={dot.cx}
          cy={BASELINE - dot.r}
          r={dot.r}
          className={i === DOTS.length - 1 ? 'mini-art-step is-top' : 'mini-art-step'}
        />
      ))}
    </svg>
  );
}
