import { describe, expect, it } from 'vitest';
import { PedalTimeline } from './pedalTimeline';
describe('페달 시각 이력', () => {
  it('역순·동일 시각·비유한 시각과 32건 상한', () => {
    const t = new PedalTimeline();
    t.add(20, true); t.add(10, false); t.add(20, false); t.add(NaN, true);
    expect([t.stateAt(9), t.stateAt(10), t.stateAt(20), t.stateAt(Infinity)]).toEqual([null, false, false, null]);
    for (let i = 30; i < 65; i++) t.add(i, true);
    expect(t.stateAt(20)).toBeNull();
    expect(t.stateAt(64)).toBe(true);
    t.clear(); expect(t.stateAt(64)).toBeNull();
  });
});
