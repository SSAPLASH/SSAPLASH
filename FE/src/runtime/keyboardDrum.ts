// 키보드 드럼 스위치. 키보드 타격은 "연주 중"인 화면에서만 받는다.
// 기본은 끔 — 곡 선택·준비·랜딩·기록·설정 같은 화면에서는 키(Space 스크롤, 개발자 도구 단축키 등)를 가로채지 않는다.
// 화면이 연주 단계에 들어올 때 켜고 떠나거나 단계가 끝나면 끈다. 화면 목록이 아니라 화면이 직접 켜고 끄는 방식이다.
// 여러 곳이 겹쳐 쓸 수 있어(드럼 세팅 화면 위의 박자 맞추기 창) 쓰는 곳 수를 세고, 0이 될 때만 끈다.
import { useEffect } from 'react';
import { keyboardSource } from './sources';

/** 키보드 소스의 keydown 처리를 켜고 끈다 */
export function setKeyboardDrum(v: boolean): void {
  keyboardSource.setEnabled(v);
}

/** useKeyboardDrum으로 켜 둔 곳의 수 */
let users = 0;

/** active인 동안 키보드 드럼을 켠다. 꺼지거나 화면을 떠나면(cleanup) 쓰는 곳이 더 없을 때 끈다 */
export function useKeyboardDrum(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    users += 1;
    setKeyboardDrum(true);
    return () => {
      users = Math.max(0, users - 1);
      setKeyboardDrum(users > 0);
    };
  }, [active]);
}
