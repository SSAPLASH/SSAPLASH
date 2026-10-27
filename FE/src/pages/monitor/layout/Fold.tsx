// 접이식 패널. 기본은 접힘이고, 접힌 동안은 자식을 렌더하지 않는다(캔버스 비용).
// 펼침 상태는 localStorage에 기억한다. 외부에서 열어야 하면 openSignal을 0이 아닌 새 값으로 바꾼다.
import { useEffect, useState } from 'react';

const KEY_PREFIX = 'mon.fold.';

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(KEY_PREFIX + id, open ? '1' : '0');
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 화면은 정상이다
  }
}

export function Fold({
  id,
  title,
  openSignal = 0,
  children,
}: {
  /** localStorage 키. 모니터 안에서 겹치지 않게 */
  id: string;
  title: string;
  /** 0이 아닌 값으로 바뀔 때(마운트 시 이미 0이 아니면 그때도) 패널을 연다 */
  openSignal?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id));
  const [seenSignal, setSeenSignal] = useState(0);

  // 렌더 중 상태 조정: 새 신호가 오면 연다(효과 안에서 setState하지 않는다)
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    if (openSignal !== 0 && !open) setOpen(true);
  }

  useEffect(() => {
    writeOpen(id, open);
  }, [id, open]);

  return (
    <section className={`mon-fold${open ? ' open' : ''}`}>
      <button className="mon-fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mon-fold-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
      </button>
      {open && <div className="mon-fold-body">{children}</div>}
    </section>
  );
}
