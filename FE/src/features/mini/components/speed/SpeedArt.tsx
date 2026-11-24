// 「누구보다 빠르게」의 그림 (Figma glyph / 점점 빨라지는 타격). 세로 막대 줄: 왼쪽은 간격이 넓고 흐리며 오른쪽으로 갈수록 촘촘해지다가 끝의 몇 개는 브랜드 색.
// 장식이라 화면 낭독기에서 숨긴다.

/** 막대 왼쪽 x 좌표(Figma 1182:37960). 폭 8, 높이 100 */
const BAR_X = [0, 38, 73, 105, 134, 160, 183, 203, 221, 237, 252, 267, 282, 297, 312, 327] as const;
/** 끝에서 브랜드 색으로 칠할 막대 수 */
const HOT_COUNT = 5;

interface Props {
  size?: 'card' | 'hero';
}

export function SpeedArt({ size = 'card' }: Props) {
  const plain = BAR_X.length - HOT_COUNT;
  return (
    <svg
      className={`mini-art mini-art-${size}`}
      viewBox="0 0 335 120"
      width={size === 'hero' ? 360 : 132}
      height={size === 'hero' ? 120 : 48}
      aria-hidden="true"
      focusable="false"
    >
      {BAR_X.map((x, i) => (
        <rect
          key={x}
          x={x}
          y={10}
          width={8}
          height={100}
          rx={4}
          className={i >= plain ? 'mini-art-bar is-hot' : 'mini-art-bar'}
          // 오른쪽으로 갈수록 또렷해진다
          opacity={i >= plain ? 1 : 0.3 + (0.5 * i) / plain}
        />
      ))}
    </svg>
  );
}
