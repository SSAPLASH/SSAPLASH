// 곡 제목 한 줄 (설계 CHART-003 라이브러리 재생바 D3~D5·D7). 켜짐이고 제목이 칸보다 길 때만 회전목마처럼 흐른다.
// 꺼짐이거나 칸에 들어가는 제목은 기존 말줄임 span 그대로다(짧은 제목은 복제하지 않는다).
// 흐를 때는 묶음(제목 + 뒤 간격) 두 개를 나란히 두고 트랙을 −50%까지 옮겨 끊김 없이 돈다. 둘째 묶음은 aria-hidden이다.
// 움직임 줄이기 설정이면 CSS가 말줄임으로 되돌린다.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { marqueeDurationSec, marqueeOverflows } from '@/domain/song/marquee';
import './song.css';

interface Props {
  text: string;
  /** 참이면 칸보다 긴 제목이 흐른다 */
  active: boolean;
  /** 제목 자리의 기존 클래스(말줄임·글자 크기) */
  className: string;
}

export function MarqueeTitle({ text, active, className }: Props) {
  if (!active) {
    return (
      <span className={className} title={text}>
        {text}
      </span>
    );
  }
  return <ActiveTitle text={text} className={className} />;
}

function ActiveTitle({ text, className }: Omit<Props, 'active'>) {
  const rootRef = useRef<HTMLSpanElement>(null);
  /** null이면 흐르지 않는다(칸에 들어가거나 아직 재지 않음). 숫자면 한 바퀴 시간(초) */
  const [flowSec, setFlowSec] = useState<number | null>(null);
  const flowing = flowSec !== null;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      // 제목 글자 너비는 흐르든 아니든 .marquee-item 하나로 잰다
      const textPx = root.querySelector<HTMLElement>('.marquee-item')?.offsetWidth ?? 0;
      if (!marqueeOverflows(root.offsetWidth, textPx)) {
        setFlowSec(null);
        return;
      }
      // 묶음 너비(제목 + 뒤 간격)는 흐르는 구조가 된 뒤에야 잴 수 있다. 그 전에는 제목 너비로 어림한다
      const groupPx = root.querySelector<HTMLElement>('.marquee-group')?.offsetWidth ?? textPx;
      setFlowSec(marqueeDurationSec(groupPx));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // 흐르는 구조로 바뀐 뒤 묶음 너비로 한 번 더 잰다
  }, [text, flowing]);

  if (!flowing) {
    return (
      <span ref={rootRef} className={className} title={text}>
        <span className="marquee-item">{text}</span>
      </span>
    );
  }
  return (
    <span ref={rootRef} className={`${className} marquee`} title={text}>
      <span className="marquee-track" style={{ '--marquee-dur': `${flowSec}s` } as CSSProperties}>
        <span className="marquee-group">
          <span className="marquee-item">{text}</span>
        </span>
        <span className="marquee-group" aria-hidden="true">
          <span className="marquee-item">{text}</span>
        </span>
      </span>
    </span>
  );
}
