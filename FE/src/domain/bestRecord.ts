// 이 기기의 로컬 플레이 로그에서 최고 기록을 뽑는 순수 함수 (설계 U18).
// 곡 선택 = 곡별 최고 점수, 연주 준비 = 연습 단계(채보)별 최고 정확도. 기록이 없으면 Map에 키가 없다.
// 로그는 끝까지 친 판만 저장된다(PlayPage·SheetPage의 finish에서만 savePlayLog) — 중간에 나간 판은 애초에 로그가 없어 따로 거르지 않는다.
import type { PlayLog } from '@/engine/playLog';

type LogMode = PlayLog['mode'];

/** 곡별(BE 곡 id) 최고 점수. 모든 연습 단계 중 가장 높은 값. 내장 채보(곡 숫자 id 없음)는 건너뛴다 */
export function bestScoreBySong(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || l.songNumericId == null) continue;
    const score = l.summary.score;
    if (!Number.isFinite(score)) continue;
    const prev = best.get(l.songNumericId);
    if (prev === undefined || score > prev) best.set(l.songNumericId, score);
  }
  return best;
}

/** 채보(연습 단계)별 최고 정확도(0~1). 채보 id 없는 내장 채보·이전 로그는 건너뛴다 */
export function bestAccuracyByChart(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || l.chartId == null) continue;
    const acc = l.summary.accuracy;
    if (!Number.isFinite(acc)) continue;
    const prev = best.get(l.chartId);
    if (prev === undefined || acc > prev) best.set(l.chartId, acc);
  }
  return best;
}
