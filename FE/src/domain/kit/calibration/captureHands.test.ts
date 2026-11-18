// 패드별 보정 손·다른 손 앵커 만들기 검증(PLAY-004 ①, 설계 3-1·3-2)
import { describe, expect, it } from 'vitest';
import type { StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import type { HandAnchors, PadAnchor } from './calibration';
import { CAPTURE_HANDS, captureHandsFor, deriveSingleHandAnchors } from './captureHands';

const a = (pad: PadId, pitch: number, yaw: number): PadAnchor => ({ pad, pitch, yaw, radius: 18, samples: 2, spread: 1 });

describe('captureHandsFor', () => {
  it('표: 라이드만 오른손', () => {
    expect(CAPTURE_HANDS).toEqual({ RIDE: [1] });
  });
  it('양손 세션의 라이드는 오른손만', () => {
    expect(captureHandsFor('RIDE', [0, 1])).toEqual([1]);
  });
  it('왼손만 세션이면 라이드도 왼손이 받는다', () => {
    expect(captureHandsFor('RIDE', [0])).toEqual([0]);
  });
  it('표에 없는 패드는 세션 손 전부(순서 유지)', () => {
    expect(captureHandsFor('SNARE', [0, 1])).toEqual([0, 1]);
    expect(captureHandsFor('SNARE', [1])).toEqual([1]);
    expect(captureHandsFor('HIHAT', [0])).toEqual([0]);
  });
  it('세션 손이 비면 빈 배열', () => {
    expect(captureHandsFor('RIDE', [])).toEqual([]);
  });
});

describe('deriveSingleHandAnchors', () => {
  const base = (): HandAnchors => [
    { SNARE: a('SNARE', -18, -25) },
    { SNARE: a('SNARE', -20, -5), RIDE: a('RIDE', 10, 40) },
  ];
  const captured: { pad: PadId; hands: StickId[] }[] = [{ pad: 'RIDE', hands: [1] }];

  it('오른손 라이드 + 스네어 양손 차이로 왼손 라이드를 만든다', () => {
    const out = deriveSingleHandAnchors(base(), captured);
    expect(out[0]?.RIDE).toMatchObject({ pad: 'RIDE', pitch: 12, yaw: 20, derived: true, samples: 0, spread: 0 });
    expect(out[0]?.SNARE?.yaw).toBe(-25);
    expect(out[1]?.RIDE?.derived).toBeUndefined();
  });

  it('왼손이 친 라이드면 오른손 앵커를 만든다', () => {
    const anchors: HandAnchors = [{ SNARE: a('SNARE', -18, -25), RIDE: a('RIDE', 12, 20) }, { SNARE: a('SNARE', -20, -5) }];
    const out = deriveSingleHandAnchors(anchors, [{ pad: 'RIDE', hands: [0] as StickId[] }]);
    expect(out[1]?.RIDE).toMatchObject({ pitch: 10, yaw: 40, derived: true });
  });

  it('radiusOverride는 복사하지 않고 radius는 임시로 친 손 값', () => {
    const anchors = base();
    anchors[1]!.RIDE!.radiusOverride = 30;
    const out = deriveSingleHandAnchors(anchors, captured);
    expect(out[0]?.RIDE?.radiusOverride).toBeUndefined();
    expect(out[0]?.RIDE?.radius).toBe(18);
  });

  it('yaw는 ±180으로 접고 pitch는 ±90으로 자른다', () => {
    const anchors: HandAnchors = [
      { SNARE: a('SNARE', 60, 170) },
      { SNARE: a('SNARE', -60, -170), RIDE: a('RIDE', 80, 170) },
    ];
    const out = deriveSingleHandAnchors(anchors, captured);
    // yaw 차 = wrap180(170 − (−170)) = −20 → 170 + (−20)... 다른 손(왼, 170) − 친 손(오, −170) = 340 → −20, 라이드 170 + (−20) = 150
    expect(out[0]?.RIDE?.yaw).toBeCloseTo(150);
    // pitch 80 + (60 − (−60)) = 200 → 90
    expect(out[0]?.RIDE?.pitch).toBe(90);
    const wrap: HandAnchors = [{ SNARE: a('SNARE', 0, -170) }, { SNARE: a('SNARE', 0, 170), RIDE: a('RIDE', 0, 175) }];
    // 왼 − 오 = −340 → 20, 175 + 20 = 195 → −165
    expect(deriveSingleHandAnchors(wrap, captured)[0]?.RIDE?.yaw).toBeCloseTo(-165);
  });

  it('스네어가 한쪽이라도 없으면 그대로', () => {
    const noLeft: HandAnchors = [{ HIHAT: a('HIHAT', 0, 0) }, { SNARE: a('SNARE', -20, -5), RIDE: a('RIDE', 10, 40) }];
    expect(deriveSingleHandAnchors(noLeft, captured)[0]).toEqual({ HIHAT: a('HIHAT', 0, 0) });
    const noRight: HandAnchors = [{ SNARE: a('SNARE', -18, -25) }, { RIDE: a('RIDE', 10, 40) }];
    expect(deriveSingleHandAnchors(noRight, captured)[0]).toEqual({ SNARE: a('SNARE', -18, -25) });
  });

  it('다른 손 묶음이 null이면 그대로(null)', () => {
    const anchors: HandAnchors = [null, { SNARE: a('SNARE', -20, -5), RIDE: a('RIDE', 10, 40) }];
    expect(deriveSingleHandAnchors(anchors, captured)[0]).toBeNull();
  });

  it('양손이 친 패드·표에 없는 패드는 건드리지 않는다', () => {
    const anchors = base();
    expect(deriveSingleHandAnchors(anchors, [{ pad: 'RIDE', hands: [0, 1] as StickId[] }])[0]).toEqual(anchors[0]);
    expect(deriveSingleHandAnchors(anchors, [{ pad: 'SNARE', hands: [1] as StickId[] }])[0]).toEqual(anchors[0]);
  });

  it('입력을 고치지 않고 새 객체를 돌려준다', () => {
    const anchors = base();
    const snapshot = structuredClone(anchors);
    const out = deriveSingleHandAnchors(anchors, captured);
    expect(anchors).toEqual(snapshot);
    expect(out).not.toBe(anchors);
    expect(out[0]).not.toBe(anchors[0]);
  });
});
