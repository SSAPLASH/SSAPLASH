// 세팅 화면 울림 버튼(프리셋 슬롯 카드·상태 타일): 마우스를 올리면 가운데서 약한 울림 링, 누르면 누른 자리에서 강한 울림 링과 짧은 눌림이 난다(패드를 친 느낌).
// 링은 표시 전용 span이고 애니메이션이 끝나면 지운다. 동작 줄이기 설정이면 CSS가 링을 감춘다.
import { useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';

interface Ring {
  id: number;
  x: number;
  y: number;
  strong: boolean;
}

/** 한 카드에 동시에 남겨 둘 최대 링 수 */
const MAX_RINGS = 4;

export function StrikeButton({ children, id, className, onPointerEnter, onPointerDown, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [rings, setRings] = useState<Ring[]>([]);
  const [hitKey, setHitKey] = useState(0);
  const seq = useRef(0);

  const fire = (e: PointerEvent<HTMLButtonElement>, strong: boolean) => {
    if (rest.disabled) return;
    const box = e.currentTarget.getBoundingClientRect();
    // 호버 울림은 가운데서, 누름 울림은 누른 자리에서 퍼진다
    const x = strong ? e.clientX - box.left : box.width / 2;
    const y = strong ? e.clientY - box.top : box.height / 2;
    const id = ++seq.current;
    setRings((list) => [...list.slice(-(MAX_RINGS - 1)), { id, x, y, strong }]);
    if (strong) setHitKey(id);
  };

  return (
    // 속성 순서(id → class → 나머지)를 원래 버튼과 같게 둔다(마크업을 보는 테스트가 있다)
    <button
      id={id}
      className={`${className ?? ''}${hitKey ? ' is-struck' : ''}`}
      {...rest}
      // key가 아니라 data 속성으로 눌림 애니메이션을 다시 건다(버튼을 새로 만들면 포커스가 사라진다)
      data-strike={hitKey % 2}
      onPointerEnter={(e) => {
        // 터치는 호버가 없으므로 누름 울림만 낸다
        if (e.pointerType === 'mouse') fire(e, false);
        onPointerEnter?.(e);
      }}
      onPointerDown={(e) => {
        fire(e, true);
        onPointerDown?.(e);
      }}
    >
      {children}
      <span className="setup-strike-rings" aria-hidden="true">
        {rings.map((r) => (
          <span
            key={r.id}
            className={`setup-strike-ring${r.strong ? ' strong' : ''}`}
            style={{ left: r.x, top: r.y }}
            onAnimationEnd={() => setRings((list) => list.filter((x) => x.id !== r.id))}
          />
        ))}
      </span>
    </button>
  );
}
