// 타격 → 노트 매칭 규칙 (MODE-001-judge-window 3-1). 상태를 바꾸지 않는 순수 함수.
// 기본은 판정 폭 안의 가장 이른 노트. 뒤 노트의 PERFECT 폭에 정확히 들어온 타격만 예외로 뒤 노트에 붙인다.
import type { TimingWindows } from '@/domain/play/judgement';

export interface MatchCandidate {
  index: number;
  timeMs: number;
}

export type MatchRule = 'earliest' | 'perfect-exception';

export interface MatchResult {
  /** 붙일 노트의 index. 후보가 없으면 null(채보 밖 타격) */
  pick: number | null;
  /** 후보가 둘 이상이었는가 (G4 경합) */
  contested: boolean;
  /** 고른 규칙. pick이 null이면 null */
  rule: MatchRule | null;
}

/**
 * 후보(이미 미판정·같은 패드·|t − 노트| ≤ goodMs로 걸러진 노트)에서 붙일 노트를 고른다.
 * 후보는 시각 오름차순이어야 한다(커서부터 훑어 모으면 자연히 그렇다).
 */
export function hitMatch(candidates: readonly MatchCandidate[], t: number, windows: TimingWindows): MatchResult {
  if (candidates.length === 0) return { pick: null, contested: false, rule: null };
  const contested = candidates.length > 1;
  const earliest = candidates[0];
  if (contested && Math.abs(t - earliest.timeMs) > windows.perfectMs) {
    // 예외: 뒤 후보 중 PERFECT 폭 안에 든 것(여럿이면 가장 가까운 것)
    let best: MatchCandidate | null = null;
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const d = Math.abs(t - c.timeMs);
      if (d <= windows.perfectMs && (best === null || d < Math.abs(t - best.timeMs))) best = c;
    }
    if (best) return { pick: best.index, contested, rule: 'perfect-exception' };
  }
  return { pick: earliest.index, contested, rule: 'earliest' };
}
