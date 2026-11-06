import { describe, expect, it } from 'vitest';
import { HihatPedalCoverageTracker, shouldWarnOpenHihat } from './hihatPedalCoverage';
describe('측정 완전성', () => {
  it('시작 시 확인, 중간 연결·끊김·미상과 재시작', () => {
    const complete = new HihatPedalCoverageTracker(true, true);
    expect(complete.value()).toBe('COMPLETE');
    complete.connection(true); expect(complete.value()).toBe('COMPLETE');
    complete.connection(false); complete.connection(true); expect(complete.value()).toBe('PARTIAL');
    const none = new HihatPedalCoverageTracker(false, false); expect(none.value()).toBe('NONE');
    none.connection(true); expect(none.value()).toBe('PARTIAL');
    expect(new HihatPedalCoverageTracker(true, false).value()).toBe('PARTIAL');
    const unknown = new HihatPedalCoverageTracker(true, true); unknown.unknownHit(); expect(unknown.value()).toBe('PARTIAL');
    expect(new HihatPedalCoverageTracker(true, true).value()).toBe('COMPLETE');
  });
  it('열린 성공 판정에 연결된 닫힌 페달만 경고한다', () => {
    expect(shouldWarnOpenHihat(true, 'PERFECT', true, true)).toBe(true);
    expect(shouldWarnOpenHihat(true, 'GOOD', true, true)).toBe(true);
    expect(shouldWarnOpenHihat(false, 'GOOD', true, true)).toBe(false);
    expect(shouldWarnOpenHihat(true, 'MISS', true, true)).toBe(false);
    expect(shouldWarnOpenHihat(true, 'GOOD', false, true)).toBe(false);
    expect(shouldWarnOpenHihat(true, 'GOOD', null, true)).toBe(false);
    expect(shouldWarnOpenHihat(true, 'GOOD', true, false)).toBe(false);
  });
});
