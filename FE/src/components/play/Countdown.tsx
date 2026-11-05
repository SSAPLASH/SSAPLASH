// 카운트다운 (Figma Play / Countdown 222:781, U22). 전면 딤 위에 숫자만 보인다. 박 계산은 페이지가 세션 스냅샷으로 한다.
import './Countdown.css';

interface Props {
  /** 남은 박 수(3·2·1) 또는 'go'(시작!) */
  value: number | 'go';
}

export function Countdown({ value }: Props) {
  const text = value === 'go' ? '시작!' : String(value);
  return (
    <div className="play-countdown motion-overlay" role="status" aria-live="assertive">
      <span className="play-countdown-value" data-value={String(value)}>
        {text}
      </span>
    </div>
  );
}
