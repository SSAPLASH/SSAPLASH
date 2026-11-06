import { describe, expect, it } from 'vitest';
import { collapse, initialOpen, isExpanded, openByUser, openOnFirstNeededChange } from './setupExpand';

describe('setupExpand', () => {
  it('진입 시 모자란 첫 단계만 펼치고, 다 끝났으면 아무것도 펼치지 않는다', () => {
    const open = initialOpen('calibration');
    expect(isExpanded(open, 'calibration', 'needed')).toBe(true);
    expect(isExpanded(open, 'stick', 'done')).toBe(false);
    expect(initialOpen(null)).toEqual({});
  });

  it('자동으로 펼친 단계는 끝나면 접힌다', () => {
    const open = initialOpen('stick');
    expect(isExpanded(open, 'stick', 'done')).toBe(false);
  });

  it('사용자가 연 단계는 끝나도 유지된다', () => {
    const open = openByUser({}, 'calibration');
    expect(isExpanded(open, 'calibration', 'done')).toBe(true);
    expect(isExpanded(collapse(open, 'calibration'), 'calibration', 'done')).toBe(false);
  });

  it('모자란 첫 단계가 바뀌면 새 단계를 펼침에 더하고 사용자가 연 단계는 건드리지 않는다', () => {
    const open = openOnFirstNeededChange(openByUser(initialOpen('stick'), 'stick'), 'calibration');
    expect(open).toEqual({ stick: 'user', calibration: 'auto' });
    expect(openOnFirstNeededChange(open, 'stick')).toBe(open);
    expect(openOnFirstNeededChange(open, null)).toBe(open);
  });

  it('접은 단계는 첫 단계가 그대로면 다시 열리지 않는다', () => {
    const open = collapse(initialOpen('stick'), 'stick');
    expect(isExpanded(open, 'stick', 'needed')).toBe(false);
  });
});
