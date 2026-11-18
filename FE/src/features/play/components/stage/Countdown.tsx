// 카운트다운 (Figma Play / Countdown 222:781, U22). 숫자만 보인다. 박 계산은 페이지가 domain/time/leadIn으로 한다.
// backdrop: dim = 전면 딤(곡 시작 3·2·1과 재연결 복귀 3·2·1, 일정한 세기), clear = 딤 없음(「시작!」).
// 같은 요소가 유지된 채 배경만 전환되도록 페이지는 항상 같은 위치에서 이 컴포넌트를 렌더한다 (설계 MODE-001-lead-in-bars 3-2).
import './Countdown.css';

export type CountdownBackdrop = 'dim' | 'clear';

interface Props {
  /** 남은 초(3·2·1) 또는 'go'(시작!) */
  value: number | 'go';
  backdrop?: CountdownBackdrop;
}

export function Countdown({ value, backdrop = 'dim' }: Props) {
  const text = value === 'go' ? '시작!' : String(value);
  return (
    <div
      className={`play-countdown play-countdown-${backdrop} motion-overlay`}
      role="status"
      aria-live="assertive"
      data-backdrop={backdrop}
    >
      {/* key가 값이라 숫자가 바뀔 때마다 등장 모션이 다시 재생된다(오버레이 요소는 유지) */}
      <span key={String(value)} className="play-countdown-value" data-value={String(value)}>
        {text}
      </span>
    </div>
  );
}
