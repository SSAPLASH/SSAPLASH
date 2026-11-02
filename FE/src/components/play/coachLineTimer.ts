// 코칭 문구 한 건을 displayMs 동안 들고 있다가 비우는 타이머 규칙. React 없이 순수하게 두어 fake timers로 검증한다.
// 훅(useCoachLine)은 이 모듈을 감싸 상태만 React에 올린다. 브라우저 시계(setTimeout)라 일시정지해도 멈추지 않는다.

export interface CoachLineTimer<T> {
  /** 이전 타이머를 지우고 새 문구를 displayMs 동안 보인다 */
  show(line: T, displayMs: number): void;
  /** 문구를 바로 비우고 타이머를 정리한다 */
  clear(): void;
  /** 타이머만 정리한다(언마운트). onChange는 부르지 않는다 */
  dispose(): void;
}

export function createCoachLineTimer<T>(onChange: (line: T | null) => void): CoachLineTimer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    show(line, displayMs) {
      stop();
      onChange(line);
      timer = setTimeout(() => {
        timer = null;
        onChange(null);
      }, displayMs);
    },
    clear() {
      stop();
      onChange(null);
    },
    dispose: stop,
  };
}
