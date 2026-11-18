import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { ClockSkew } from '@/domain/kit/device/arrivalSkew';
import { arrivalSkewWatch } from './arrivalSkewWatch';

let calls: Array<[ClockSkew | null, string]>;

/** 도착 지연이 lag인 타격 */
function hit(over: Partial<ResolvedHit> & { lag: number }): ResolvedHit {
  const { lag, ...rest } = over;
  return { id: 1, stickId: 0, pad: 'SNARE', velocity: 100, tHit: 1000, tRecv: 1000 + lag, tResolved: 1001 + lag, source: 'webserial', ...rest } as ResolvedHit;
}

type Lags = { left: number; right: number; pedal?: number };

/** 기기마다 1초에 한 번씩 치는 상황을 [from, to)초 동안 흘린다 */
function feed(from: number, to: number, lags: Lags): void {
  for (let s = from; s < to; s++) {
    const now = s * 1000;
    arrivalSkewWatch.observe(hit({ stickId: 0, lag: lags.left }), now);
    arrivalSkewWatch.observe(hit({ stickId: 1, lag: lags.right }), now);
    if (lags.pedal !== undefined) arrivalSkewWatch.observe(hit({ stickId: null, foot: 3, lag: lags.pedal }), now);
  }
}

/** 한 기기가 같은 시각에 표본 60개를 몰아 넣는다(창 안 표본을 통째로 바꾸는 용도) */
function burst(device: 'left' | 'right' | 'pedal', lag: number, now: number): void {
  const h = device === 'pedal' ? { stickId: null, foot: 3 as const } : { stickId: device === 'left' ? (0 as const) : (1 as const) };
  for (let i = 0; i < 60; i++) arrivalSkewWatch.observe(hit({ ...h, lag }), now);
}

const phases = () => calls.map((c) => c[1]);

beforeEach(() => {
  arrivalSkewWatch.reset();
  calls = [];
  arrivalSkewWatch.onChange((s, p) => calls.push([s, p]));
});

describe('arrivalSkewWatch', () => {
  it('20ms 넘는 차이가 30초 이어지면 start가 한 번 난다', () => {
    feed(0, 30, { left: 50, right: 10 });
    expect(calls).toHaveLength(0);
    feed(30, 40, { left: 50, right: 10 });
    expect(phases()).toEqual(['start']);
    expect(calls[0][0]?.spreadMs).toBe(40);
    expect(arrivalSkewWatch.current).not.toBeNull();
  });

  it('도중에 20ms 이하가 나오면 시작 대기를 처음부터 다시 한다', () => {
    feed(0, 10, { left: 50, right: 10 });
    // 10초 시점에 왼손 표본을 정상으로 통째로 바꿔 차이를 없앤다
    burst('left', 10, 10_000);
    // 11초에 다시 어긋나게 만든다. 이때부터 30초를 새로 센다(처음부터 이어졌다면 30초 시점에 시작했을 것)
    burst('left', 50, 11_000);
    feed(11, 40, { left: 50, right: 10 });
    expect(calls).toHaveLength(0);
    feed(40, 43, { left: 50, right: 10 });
    expect(phases()).toEqual(['start']);
  });

  it('경고 중 20ms 이하가 30초 이어지면 end가 난다', () => {
    feed(0, 40, { left: 50, right: 10 });
    expect(phases()).toEqual(['start']);
    burst('left', 10, 40_000);
    feed(41, 69, { left: 10, right: 10 });
    expect(phases()).toEqual(['start']);
    feed(69, 72, { left: 10, right: 10 });
    expect(phases()).toEqual(['start', 'end']);
    expect(arrivalSkewWatch.current).toBeNull();
  });

  it('resetDevice로 유효 기기가 둘 미만이 되면 경고가 즉시 끝난다', () => {
    feed(0, 40, { left: 50, right: 10 });
    arrivalSkewWatch.resetDevice('left', 40_000);
    expect(phases()).toEqual(['start', 'end']);
  });

  it('어긋난 기기가 바뀌면 update가 난다', () => {
    feed(0, 40, { left: 50, right: 10, pedal: 10 });
    expect(calls[0][0]?.outlier).toBe('left');
    burst('left', 10, 40_000);
    burst('right', 50, 40_000);
    expect(phases()).toEqual(['start', 'update']);
    expect(calls[1][0]?.outlier).toBe('right');
  });

  it('키보드·터치 타격은 무시한다', () => {
    for (let s = 0; s < 60; s++) {
      arrivalSkewWatch.observe(hit({ stickId: 0, lag: 90, source: 'keyboard' }), s * 1000);
      arrivalSkewWatch.observe(hit({ stickId: 1, lag: 5, source: 'touch' }), s * 1000);
    }
    expect(calls).toHaveLength(0);
  });

  it('발 타격은 pedal로 모은다', () => {
    feed(0, 40, { left: 10, right: 10, pedal: 50 });
    expect(phases()).toEqual(['start']);
    expect(calls[0][0]?.outlier).toBe('pedal');
    expect(calls[0][0]?.medians.pedal).toBe(50);
  });

  it('유한하지 않은 지연은 버린다', () => {
    const spy = vi.fn();
    arrivalSkewWatch.onChange(spy);
    for (let s = 0; s < 60; s++) arrivalSkewWatch.observe(hit({ lag: Number.NaN }), s * 1000);
    feed(0, 60, { left: 10, right: 10 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reset은 경고 중이었으면 end를 알린다', () => {
    feed(0, 40, { left: 50, right: 10 });
    arrivalSkewWatch.reset();
    expect(phases()).toEqual(['start', 'end']);
  });
});
