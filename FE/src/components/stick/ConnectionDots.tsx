// Figma Navigation / ConnectionDots 126:2006 — 72×32. 왼손(L)·오른손(R) 스틱 연결 점(연결 --good 실선, 끊김 --miss 점선).
// 설정 기기 행에서 쓴다. props만 받는다 — 연결 여부는 호출부가 liveStore에서 읽어 넘긴다.
import './ConnectionDots.css';

interface Props {
  left: boolean;
  right: boolean;
  className?: string;
}

function Dot({ hand, connected }: { hand: 'L' | 'R'; connected: boolean }) {
  return (
    <span className={`stick-conn-dot ${connected ? 'on' : 'off'}`}>
      {hand}
    </span>
  );
}

export function ConnectionDots({ left, right, className }: Props) {
  const label = `왼손 스틱 ${left ? '연결됨' : '끊김'}, 오른손 스틱 ${right ? '연결됨' : '끊김'}`;
  return (
    <span className={['stick-conn-dots', className ?? ''].filter(Boolean).join(' ')} role="img" aria-label={label}>
      <Dot hand="L" connected={left} />
      <Dot hand="R" connected={right} />
    </span>
  );
}
