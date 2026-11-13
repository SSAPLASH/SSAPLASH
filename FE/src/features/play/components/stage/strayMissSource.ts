// 세션의 채보 밖 타격 중 가까운 노트가 있는 것(nearDeltaMs)만 타이밍 막대 범위 밖 점으로 넘긴다(설계 MODE-003-timing-bar-miss-dot).
import type { RhythmSession } from '@/engine/RhythmSession';
import type { MissSource } from '@/features/play/domain/timingBar';

export function strayMissSource(session: Pick<RhythmSession, 'onStray'>): MissSource {
  return (onMiss) =>
    session.onStray((e) => {
      if (e.nearDeltaMs !== null) onMiss(e.nearDeltaMs);
    });
}
