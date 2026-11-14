// 실수 안내 고르기(pickCaptureHint) 검증(PLAY-004 v0.4 D15~D19): 평소 없음, ① 연속 퍼짐, ② 다시 치는 패드의 이웃, ③ 안 잡힘의 손 고르기, 순서, 띄우지 않는 때.
import { describe, expect, it } from 'vitest';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';
import { SPREAD_STREAK_MIN, pickCaptureHint } from './hintPick';

function cap(over: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return {
    phase: 'capturing',
    hands: [0, 1],
    targetHands: [0, 1],
    wrongHand: null,
    order: [...CAPTURE_ORDER],
    index: 1,
    target: 'CRASH',
    counts: [0, 0],
    captured: {},
    warning: null,
    gapWarnings: [],
    advancing: false,
    lastAccepted: null,
    radiusOverrides: {},
    base: [null, null],
    spreadStreak: [0, 0],
    gapHints: [],
    ...over,
  };
}

describe('pickCaptureHint', () => {
  it('실수가 없으면 안내가 없다', () => {
    expect(pickCaptureHint(cap(), false, false)).toBeNull();
    expect(pickCaptureHint(cap({ spreadStreak: [SPREAD_STREAK_MIN - 1, 0] }), false, false)).toBeNull();
  });

  it('① 받을 손의 퍼짐 경고가 2번 연속이면 같은 지점 안내', () => {
    expect(pickCaptureHint(cap({ spreadStreak: [0, 2] }), false, false)).toEqual({ kind: 'same', pad: 'CRASH' });
    // 받을 손이 아닌 손의 기록은 보지 않는다
    expect(pickCaptureHint(cap({ targetHands: [1], spreadStreak: [3, 0] }), false, false)).toBeNull();
  });

  it('② 다시 치는 패드의 기록이 있으면 가장 가까운 이웃을 가리킨다. 다른 패드의 기록은 무시한다', () => {
    const gapHints: CaptureSnapshot['gapHints'] = [
      { stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 12 },
      { stickId: 1, pad: 'CRASH', near: 'SMALL_TOM', deg: 9 },
    ];
    expect(pickCaptureHint(cap({ gapHints }), false, false)).toEqual({ kind: 'away', pad: 'CRASH', near: 'SMALL_TOM' });
    expect(pickCaptureHint(cap({ target: 'SNARE', gapHints }), false, false)).toBeNull();
  });

  it('③ 안 잡히면 아직 못 채운 손 가운데 타격 수가 적은 손, 같으면 왼손', () => {
    expect(pickCaptureHint(cap(), true, false)).toEqual({ kind: 'aim', pad: 'CRASH', stickId: 0 });
    expect(pickCaptureHint(cap({ counts: [1, 0] }), true, false)).toEqual({ kind: 'aim', pad: 'CRASH', stickId: 1 });
    expect(pickCaptureHint(cap({ counts: [2, 1] }), true, false)).toEqual({ kind: 'aim', pad: 'CRASH', stickId: 1 });
    expect(pickCaptureHint(cap({ target: 'RIDE', targetHands: [1] }), true, false)).toEqual({ kind: 'aim', pad: 'RIDE', stickId: 1 });
  });

  it('순서는 ① → ② → ③', () => {
    const gapHints: CaptureSnapshot['gapHints'] = [{ stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 12 }];
    expect(pickCaptureHint(cap({ spreadStreak: [2, 0], gapHints }), true, false)?.kind).toBe('same');
    expect(pickCaptureHint(cap({ gapHints }), true, false)?.kind).toBe('away');
  });

  it('첫 안내가 떠 있거나 진행 중이 아니면(자동 진행 대기·결과 화면) 띄우지 않는다', () => {
    const busy = { spreadStreak: [2, 2] as [number, number] };
    expect(pickCaptureHint(cap(busy), true, true)).toBeNull();
    expect(pickCaptureHint(cap({ ...busy, phase: 'padDone' }), true, false)).toBeNull();
    expect(pickCaptureHint(cap({ ...busy, phase: 'done', target: null, targetHands: [] }), true, false)).toBeNull();
  });

  it('옛 스냅샷(새 필드 없음)에서도 깨지지 않는다', () => {
    const old = cap() as Partial<CaptureSnapshot>;
    delete old.spreadStreak;
    delete old.gapHints;
    expect(pickCaptureHint(old as CaptureSnapshot, false, false)).toBeNull();
  });
});
