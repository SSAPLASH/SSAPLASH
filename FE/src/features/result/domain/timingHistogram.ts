// 결과 화면 타이밍 분포 계산. Δms(−goodMs~+goodMs)를 bins칸으로 나누고 평균 Δ·빠름/늦음 평균을 함께 낸다.
import type { PlayLog } from '@/domain/play/playLog';

export interface TimingHistogram {
  counts: number[];
  /** 칸 중앙이 퍼펙트 범위 안인지 */
  perfectIdx: boolean[];
  early: number | null;
  late: number | null;
  /** 판정된 노트 deltaMs 평균. 없으면 null */
  meanDeltaMs: number | null;
}

export function timingHistogram(log: Pick<PlayLog, 'timing' | 'notes'>, bins = 12): TimingHistogram {
  const g = log.timing.goodMs;
  const p = log.timing.perfectMs;
  const counts = new Array<number>(bins).fill(0);
  const width = (2 * g) / bins;
  const perfectIdx = counts.map((_, i) => Math.abs(-g + (i + 0.5) * width) <= p);
  let eSum = 0;
  let eN = 0;
  let lSum = 0;
  let lN = 0;
  let sum = 0;
  let n = 0;
  for (const note of log.notes) {
    if (note.deltaMs === null) continue;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((note.deltaMs + g) / width)));
    counts[i] += 1;
    sum += note.deltaMs;
    n += 1;
    if (note.deltaMs < 0) {
      eSum += note.deltaMs;
      eN += 1;
    } else if (note.deltaMs > 0) {
      lSum += note.deltaMs;
      lN += 1;
    }
  }
  return { counts, perfectIdx, early: eN ? eSum / eN : null, late: lN ? lSum / lN : null, meanDeltaMs: n ? sum / n : null };
}
