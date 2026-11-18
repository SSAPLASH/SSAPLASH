import '@/features/play/components/play.css';

const HAND_LABEL = ['왼손', '오른손'] as const;

/** 코칭 문구가 손을 가리킬 때 킷 슬롯 왼쪽 아래에 띄우는 작은 칩. 문구와 함께 나타나고 사라진다 */
export function CoachHandChip({ hand }: { hand: 0 | 1 }) {
  return (
    <span className="coach-hand-chip" aria-hidden="true">
      {HAND_LABEL[hand]}
    </span>
  );
}
