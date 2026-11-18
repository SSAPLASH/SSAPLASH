// 문구 한 건을 displayMs 동안 들고 있다가 비우는 제네릭 훅. 어떤 문구인지는 모른다(coach를 가져오지 않는다).
// 타이머 규칙은 순수 모듈 coachLineTimer에 있고(테스트는 그쪽), 여기서는 상태를 React에 올리고 언마운트에서 정리만 한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CoachLineTimer, createCoachLineTimer } from './coachLineTimer';

export interface CoachLineControl<T> {
  line: T | null;
  /** 이전 타이머를 지우고 새 문구를 delayMs 뒤부터(기본 바로) displayMs 동안 보인다 */
  show: (line: T, displayMs: number, delayMs?: number) => void;
  /** 아직 띄우지 않은(미루는 중인) 문구만 버린다. 떠 있는 문구는 그대로 둔다 */
  cancelPending: () => void;
  /** 문구를 바로 비우고 타이머를 정리한다 */
  clear: () => void;
}

export function useCoachLine<T>(): CoachLineControl<T> {
  const [line, setLine] = useState<T | null>(null);
  const timer = useRef<CoachLineTimer<T> | null>(null);
  if (timer.current === null) timer.current = createCoachLineTimer<T>(setLine);

  useEffect(() => () => timer.current?.dispose(), []);

  const show = useCallback((next: T, displayMs: number, delayMs?: number) => timer.current?.show(next, displayMs, delayMs), []);
  const cancelPending = useCallback(() => timer.current?.cancelPending(), []);
  const clear = useCallback(() => timer.current?.clear(), []);

  return { line, show, cancelPending, clear };
}
