// 곡 난이도 표시(쉬움·보통·어려움). 공용 StatusPill에 난이도별 색을 매핑한다 — 화면에서는 묶음 2부터 쓴다.
import { StatusPill } from '@/components/ui/StatusPill';
import type { Difficulty } from '@/domain/chart';
import { DIFFICULTY_LABEL } from '@/domain/songCatalog';

const VARIANT = {
  EASY: 'ok',
  NORMAL: 'accent',
  HARD: 'amber',
} as const satisfies Record<Difficulty, 'ok' | 'accent' | 'amber'>;

interface Props {
  difficulty: Difficulty;
  className?: string;
}

export function DifficultyChip({ difficulty, className }: Props) {
  return (
    <StatusPill variant={VARIANT[difficulty]} className={className}>
      {DIFFICULTY_LABEL[difficulty]}
    </StatusPill>
  );
}
