import './play.css';

export type GuideSlotMode = 'guide' | 'coach-info' | 'coach-warn';

interface Props {
  mode: GuideSlotMode;
  title: string;
  sub?: string;
}

/** 연주 화면 드럼 영역 왼쪽 안내 칸(220×51). 코칭 문구가 올 때도 하이웨이를 가리지 않도록 이 칸에서만 바꾼다 */
export function GuideSlot({ mode, title, sub }: Props) {
  return (
    <div className={`guide-slot ${mode}`}>
      {mode !== 'guide' && <span className="guide-slot-label">실시간 코칭</span>}
      <span className="guide-slot-title">{title}</span>
      {sub && <span className="guide-slot-sub">{sub}</span>}
    </div>
  );
}
