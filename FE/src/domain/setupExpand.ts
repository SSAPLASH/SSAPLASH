// 세팅 단계 카드의 펼침 규칙(순수 함수). 펼침 = 사용자가 연 단계 ∪ 모자란 첫 단계.
// 모자란 첫 단계가 바뀌면 그 단계를 새로 펼치고, 자동으로 펼친 단계는 끝나면 접힌다.
import type { SetupStepId, SetupStepStatus } from './setupSteps';

/** user = 사용자가 직접 연 단계(끝나도 유지), auto = 모자란 첫 단계라 자동으로 펼친 단계 */
export type OpenMap = Partial<Record<SetupStepId, 'user' | 'auto'>>;

export function initialOpen(firstNeeded: SetupStepId | null): OpenMap {
  return firstNeeded ? { [firstNeeded]: 'auto' } : {};
}

/** 모자란 첫 단계가 바뀐 순간 호출한다. 사용자가 이미 연 단계는 그대로 둔다 */
export function openOnFirstNeededChange(open: OpenMap, firstNeeded: SetupStepId | null): OpenMap {
  if (firstNeeded === null || open[firstNeeded] === 'user') return open;
  return { ...open, [firstNeeded]: 'auto' };
}

export function openByUser(open: OpenMap, id: SetupStepId): OpenMap {
  return { ...open, [id]: 'user' };
}

export function collapse(open: OpenMap, id: SetupStepId): OpenMap {
  const next = { ...open };
  delete next[id];
  return next;
}

/** 자동으로 펼친 단계는 아직 모자랄 때만 펼쳐 둔다(끝나면 접는다) */
export function isExpanded(open: OpenMap, id: SetupStepId, status: SetupStepStatus): boolean {
  const how = open[id];
  return how === 'user' || (how === 'auto' && status === 'needed');
}
