// 전역 키 핸들러(D1): 포커스된 조작 요소가 소유한 키는 가로채지 않는다. 소유 판정 순수 함수.
// DOM 타입을 직접 쓰지 않고 구조 타입만 받아 node 환경에서 테스트한다.

export type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(selector: string): unknown | null;
} | null;

/** 버튼·링크가 자체 동작(클릭)으로 쓰는 키 */
export const ACTIVATION_CODES: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Space']);

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATION_ROLES = new Set(['button', 'tab', 'link']);

function tagOf(target: KeyTarget): string {
  return (target?.tagName ?? '').toUpperCase();
}

/** 입력 칸·선택 상자·편집 영역 */
export function isTextEntryTarget(target: KeyTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TEXT_ENTRY_TAGS.has(tagOf(target));
}

/** Enter·Space로 활성화하는 요소: button, a, role=button·tab·link */
export function isActivationTarget(target: KeyTarget): boolean {
  if (!target) return false;
  const tag = tagOf(target);
  if (tag === 'BUTTON' || tag === 'A') return true;
  const role = target.getAttribute?.('role');
  return role != null && ACTIVATION_ROLES.has(role);
}

/** role=dialog 안에 있는가. closest가 없으면 거짓 */
export function isInsideDialog(target: KeyTarget): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest('[role="dialog"]') != null;
}

/** range 입력(진행 막대·음량)이 스스로 쓰는 키. 그 밖의 키(드럼 연주 키)는 range에 초점이 있어도 통과시킨다 */
export const RANGE_CODES: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** input type=range */
export function isRangeTarget(target: KeyTarget): boolean {
  return tagOf(target) === 'INPUT' && target?.getAttribute?.('type') === 'range';
}

/** 포커스 대상이 이 키를 스스로 처리하는가. 참이면 전역 핸들러는 통과해야 한다 */
export function isKeyOwnedByTarget(target: KeyTarget, code: string): boolean {
  if (!target) return false;
  if (isRangeTarget(target) && !isInsideDialog(target)) return RANGE_CODES.has(code);
  if (isTextEntryTarget(target)) return true;
  if (isInsideDialog(target)) return true;
  if (isActivationTarget(target)) return ACTIVATION_CODES.has(code);
  return false;
}
