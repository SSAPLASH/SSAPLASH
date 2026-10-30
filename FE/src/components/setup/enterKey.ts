// 복귀 띠의 Enter 처리 조건(순수 함수). 컴포넌트 파일과 분리해 단위 테스트한다.

type EnterTarget = { tagName?: string; isContentEditable?: boolean } | null;

/** Enter를 가로채면 안 되는 포커스 대상: 입력 칸·선택 상자·편집 영역, 그리고 Enter가 자체 동작인 버튼·링크 */
export function isEnterBlockedTarget(target: EnterTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A';
}

export function shouldReturnOnEnter(ready: boolean, enterEnabled: boolean, target: EnterTarget): boolean {
  return ready && enterEnabled && !isEnterBlockedTarget(target);
}
