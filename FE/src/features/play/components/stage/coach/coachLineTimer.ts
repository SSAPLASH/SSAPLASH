// 코칭 문구 한 건을 displayMs 동안 들고 있다가 비우는 타이머 규칙. React 없이 순수하게 두어 fake timers로 검증한다.
// 훅(useCoachLine)은 이 모듈을 감싸 상태만 React에 올린다. 브라우저 시계(setTimeout)라 일시정지해도 멈추지 않는다.
// 바쁜 구간에서는 delayMs만큼 미뤄서 띄운다(coachDisplay). 미루는 동안 새 문구가 오면 앞의 것은 버린다.

export interface CoachLineTimer<T> {
  /** 이전 타이머를 지우고 새 문구를 delayMs 뒤부터(기본 바로) displayMs 동안 보인다 */
  show(line: T, displayMs: number, delayMs?: number): void;
  /** 아직 띄우지 않은(미루는 중인) 문구만 버린다. 이미 떠 있는 문구는 그대로 둔다(일시정지) */
  cancelPending(): void;
  /** 문구를 바로 비우고 타이머를 정리한다 */
  clear(): void;
  /** 타이머만 정리한다(언마운트). onChange는 부르지 않는다 */
  dispose(): void;
}

export function createCoachLineTimer<T>(onChange: (line: T | null) => void): CoachLineTimer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const stopPending = (): void => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
  };
  const stop = (): void => {
    stopPending();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const present = (line: T, displayMs: number): void => {
    onChange(line);
    timer = setTimeout(() => {
      timer = null;
      onChange(null);
    }, displayMs);
  };

  return {
    show(line, displayMs, delayMs = 0) {
      stop();
      if (delayMs <= 0) {
        present(line, displayMs);
        return;
      }
      // 앞 문구가 남아 있으면 새 문구가 뜨기 전에 비운다
      onChange(null);
      pending = setTimeout(() => {
        pending = null;
        present(line, displayMs);
      }, delayMs);
    },
    cancelPending: stopPending,
    clear() {
      stop();
      onChange(null);
    },
    dispose: stop,
  };
}
