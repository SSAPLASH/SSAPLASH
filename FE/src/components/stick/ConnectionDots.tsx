// Figma Navigation / ConnectionDots 126:2006 — 72×32. 왼손(L)·오른손(R) 스틱 연결 점(연결 --good 실선, 끊김 --miss 점선).
// 설정 기기 행에서 쓴다. props만 받는다 — 연결 여부는 호출부가 liveStore에서 읽어 넘긴다.
import { CONNECTED_TEXT, DEVICE_META, DISCONNECTED_TEXT } from '@/domain/kit/devices';
import './ConnectionDots.css';

interface Props {
  left: boolean;
  right: boolean;
  className?: string;
}

function Dot({ hand, connected }: { hand: 'LEFT' | 'RIGHT'; connected: boolean }) {
  return (
    <span className={`stick-conn-dot ${connected ? 'on' : 'off'}`}>
      {DEVICE_META[hand].mark}
    </span>
  );
}

export function ConnectionDots({ left, right, className }: Props) {
  const label = `${DEVICE_META.LEFT.name} 스틱 ${left ? CONNECTED_TEXT : DISCONNECTED_TEXT}, ${DEVICE_META.RIGHT.name} 스틱 ${right ? CONNECTED_TEXT : DISCONNECTED_TEXT}`;
  return (
    <span className={['stick-conn-dots', className ?? ''].filter(Boolean).join(' ')} role="img" aria-label={label}>
      <Dot hand="LEFT" connected={left} />
      <Dot hand="RIGHT" connected={right} />
    </span>
  );
}
