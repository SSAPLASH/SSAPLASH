// 키 소유 판별 테스트: 전역 핸들러가 가로채면 안 되는 포커스 대상
import { describe, expect, it } from 'vitest';
import { isActivationTarget, isInsideDialog, isKeyOwnedByTarget, isTextEntryTarget } from './keyTarget';

const dialogChild = { tagName: 'DIV', closest: (s: string) => (s === '[role="dialog"]' ? {} : null) };
const outside = { tagName: 'DIV', closest: () => null };

describe('isKeyOwnedByTarget', () => {
  it('target이 null이거나 body면 소유하지 않는다', () => {
    expect(isKeyOwnedByTarget(null, 'Enter')).toBe(false);
    expect(isKeyOwnedByTarget({ tagName: 'BODY' }, 'Space')).toBe(false);
    expect(isKeyOwnedByTarget(outside, 'Escape')).toBe(false);
  });

  it('버튼은 Enter·NumpadEnter·Space만 소유한다', () => {
    const button = { tagName: 'BUTTON' };
    for (const code of ['Enter', 'NumpadEnter', 'Space']) expect(isKeyOwnedByTarget(button, code)).toBe(true);
    for (const code of ['Escape', 'KeyF', 'Tab']) expect(isKeyOwnedByTarget(button, code)).toBe(false);
  });

  it('링크·role=button은 활성화 키를 소유한다', () => {
    expect(isKeyOwnedByTarget({ tagName: 'A' }, 'Enter')).toBe(true);
    expect(isKeyOwnedByTarget({ tagName: 'A' }, 'Escape')).toBe(false);
    const roleBtn = { tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'button' : null) };
    expect(isKeyOwnedByTarget(roleBtn, 'Space')).toBe(true);
    expect(isKeyOwnedByTarget(roleBtn, 'KeyF')).toBe(false);
  });

  it('입력 칸·편집 영역은 모든 키를 소유한다', () => {
    expect(isKeyOwnedByTarget({ tagName: 'INPUT' }, 'KeyF')).toBe(true);
    expect(isKeyOwnedByTarget({ tagName: 'textarea' }, 'Space')).toBe(true);
    expect(isKeyOwnedByTarget({ tagName: 'SELECT' }, 'Escape')).toBe(true);
    expect(isKeyOwnedByTarget({ tagName: 'DIV', isContentEditable: true }, 'Escape')).toBe(true);
  });

  it('range 입력(진행 막대)은 방향키·Home·End·PageUp·PageDown만 소유하고 연주 키는 통과시킨다', () => {
    const range = { tagName: 'INPUT', getAttribute: (n: string) => (n === 'type' ? 'range' : null), closest: () => null };
    for (const code of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp']) expect(isKeyOwnedByTarget(range, code)).toBe(true);
    for (const code of ['KeyF', 'KeyJ', 'Space', 'Digit1']) expect(isKeyOwnedByTarget(range, code)).toBe(false);
    // 다이얼로그 안의 range는 기존처럼 모든 키를 소유한다
    const rangeInDialog = { ...range, closest: (s: string) => (s === '[role="dialog"]' ? {} : null) };
    expect(isKeyOwnedByTarget(rangeInDialog, 'KeyF')).toBe(true);
  });

  it('다이얼로그 안은 모든 키를 소유한다', () => {
    for (const code of ['Enter', 'Escape', 'Tab', 'KeyF', 'Space']) {
      expect(isKeyOwnedByTarget(dialogChild, code)).toBe(true);
    }
  });
});

describe('보조 판별 함수', () => {
  it('isTextEntryTarget / isActivationTarget', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isActivationTarget({ tagName: 'BUTTON' })).toBe(true);
    expect(isActivationTarget({ tagName: 'DIV', getAttribute: () => 'tab' })).toBe(true);
    expect(isActivationTarget(null)).toBe(false);
  });

  it('isInsideDialog는 closest가 없으면 거짓이다', () => {
    expect(isInsideDialog({ tagName: 'DIV' })).toBe(false);
    expect(isInsideDialog(dialogChild)).toBe(true);
    expect(isInsideDialog(null)).toBe(false);
  });
});
