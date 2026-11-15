import '../play.css';

export type GuideSlotMode = 'guide' | 'coach-info' | 'coach-warn' | 'coach-good';

interface Props {
  mode: GuideSlotMode;
  title: string;
  sub?: string;
  /** lg: 악보 연습의 큰 코칭 모양(제목 26/800·보조 17/600, 종류별 색 면). 기본은 220×51 칸 */
  size?: 'md' | 'lg';
}

/** 연주 화면 드럼 영역 왼쪽 안내 칸(220×51). 코칭 문구가 올 때도 하이웨이를 가리지 않도록 이 칸에서만 바꾼다 */
export function GuideSlot({ mode, title, sub, size = 'md' }: Props) {
  const coach = mode !== 'guide';
  return (
    // 기본 모드에는 클래스를 붙이지 않는다: `guide`는 곡 선택 안내 줄(guide.css `.guide`, 2열 grid)과 이름이 겹쳐 글이 세로로 꺾였다
    <div className={`guide-slot${coach ? ` ${mode}` : ''}${coach && size === 'lg' ? ' lg' : ''}`} role={coach ? 'status' : undefined}>
      {mode !== 'guide' && <span className="guide-slot-label">실시간 코칭</span>}
      <span className="guide-slot-title">{title}</span>
      {sub && <span className="guide-slot-sub">{sub}</span>}
    </div>
  );
}
