// 재정렬 상태 기계 검증(PLAY-004 3-6): 손별 d, 대상 아닌 손 null, 앵커 없는 손 제외, ±180° 접기.
import { describe, expect, it } from 'vitest';
import { SnareRealign } from './SnareRealign';

describe('SnareRealign', () => {
  it('대상 손의 첫 스네어 타격은 d = 친 방위각 − 저장 방위각, 그 손은 완료', () => {
    const r = new SnareRealign();
    r.start([0, 1], [-20, 10]);
    expect(r.snapshot()).toEqual({ hands: [0, 1], done: [false, false], finished: false });
    expect(r.onHit(0, { pitch: -10, yaw: -14 })).toBeCloseTo(6);
    expect(r.snapshot()).toEqual({ hands: [0, 1], done: [true, false], finished: false });
    expect(r.onHit(1, { pitch: -10, yaw: 3 })).toBeCloseTo(-7);
    expect(r.snapshot().finished).toBe(true);
  });

  it('이미 끝난 손·대상이 아닌 손은 null', () => {
    const r = new SnareRealign();
    r.start([1], [-20, 10]);
    expect(r.onHit(0, { pitch: 0, yaw: 0 })).toBeNull();
    expect(r.onHit(1, { pitch: 0, yaw: 12 })).toBeCloseTo(2);
    expect(r.onHit(1, { pitch: 0, yaw: 30 })).toBeNull();
    expect(r.targets(1)).toBe(false);
  });

  it('저장 스네어 앵커가 없는 손(null)은 대상에서 빠진다', () => {
    const r = new SnareRealign();
    r.start([0, 1], [null, 10]);
    expect(r.snapshot().hands).toEqual([1]);
    expect(r.onHit(0, { pitch: 0, yaw: 0 })).toBeNull();
  });

  it('d는 (−180, 180]로 접힌다', () => {
    const r = new SnareRealign();
    r.start([0], [170, null]);
    expect(r.onHit(0, { pitch: 0, yaw: -175 })).toBeCloseTo(15);
  });

  it('dropHand는 대상에서 빼고, 남은 손이 다 끝났으면 finished', () => {
    const r = new SnareRealign();
    r.start([0, 1], [0, 0]);
    r.onHit(0, { pitch: 0, yaw: 1 });
    r.dropHand(1);
    expect(r.snapshot()).toEqual({ hands: [0], done: [true, false], finished: true });
  });

  it('대상이 없으면 처음부터 finished', () => {
    const r = new SnareRealign();
    r.start([], [0, 0]);
    expect(r.snapshot().finished).toBe(true);
  });
});
