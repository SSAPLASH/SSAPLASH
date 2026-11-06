// 2타 보정 상태 기계 검증(PLAY-004 3-5, UX-64 D3): 순서·손별 2타·확인 대기(padDone)·next·퍼짐 되돌림·손 추가/제거·redo/restart·build.
import { describe, expect, it } from 'vitest';
import { CAPTURE_ORDER, HitCapture } from './HitCapture';
import { DEFAULT_SENSOR_TUNING } from '@/domain/tuning';

const P = (pitch: number, yaw: number) => ({ pitch, yaw });

/** 손 h가 자세 p로 두 번 친다(두 번째는 1° 옆) */
function twice(c: HitCapture, h: 0 | 1, pitch: number, yaw: number) {
  expect(c.onHit(h, P(pitch, yaw), 100)).toBe(true);
  expect(c.onHit(h, P(pitch, yaw + 1), 200)).toBe(true);
}

/** 순서대로 7패드를 양손 모두 채우고 패드마다 [다음]. 손마다 다른 자리 */
function fillAll(c: HitCapture) {
  CAPTURE_ORDER.forEach((_, i) => {
    twice(c, 0, -10 + i * 5, -40 + i * 12);
    twice(c, 1, -10 + i * 5, -20 + i * 12);
    c.next();
  });
}

describe('HitCapture 순서·카운트', () => {
  it('시작하면 capturing·스네어가 목표, 카운트 0', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', index: 0, counts: [0, 0], hands: [0, 1], radiusOverrides: {} });
  });

  it('손 목록이 비면 바로 done', () => {
    const c = new HitCapture();
    c.start([]);
    expect(c.snapshot().phase).toBe('done');
  });

  it('양손 2타씩 채우면 확인 대기(padDone)이고 next()로 다음 패드. 한 손만 채우면 그대로', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', counts: [2, 0] });
    twice(c, 1, -10, 5);
    // 자동으로 넘어가지 않는다: 목표는 방금 채운 스네어, 카운트도 남아 있다
    expect(c.snapshot()).toMatchObject({ phase: 'padDone', target: 'SNARE', index: 0, counts: [2, 2] });
    expect(c.snapshot().captured.SNARE?.[0]).toMatchObject({ pad: 'SNARE', samples: 2 });
    expect(c.snapshot().captured.SNARE?.[0]?.yaw).toBeCloseTo(0.5);
    c.next();
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', index: 1, counts: [0, 0] });
  });

  it('확인 대기 중 타격은 무시(false), 다른 단계의 next()는 무동작', () => {
    const c = new HitCapture();
    c.start([0]);
    c.next();
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE' });
    twice(c, 0, -10, 0);
    expect(c.onHit(0, P(-10, 0))).toBe(false);
    expect(c.snapshot()).toMatchObject({ phase: 'padDone', counts: [2, 0] });
  });

  it('이미 2타를 채운 손의 타격은 무시(false), 대상이 아닌 손도 무시', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    expect(c.onHit(0, P(-10, 0))).toBe(false); // 왼손은 찼고 오른손을 기다리는 중
    expect(c.snapshot().counts).toEqual([2, 0]);
    const one = new HitCapture();
    one.start([0]);
    expect(one.onHit(1, P(-10, 0))).toBe(false); // 대상이 아닌 손
    twice(one, 0, -10, 0);
    // 한 손만 대상이면 그 손이 채우는 순간 확인 대기
    expect(one.snapshot()).toMatchObject({ phase: 'padDone', target: 'SNARE' });
  });

  it('7패드를 다 채우고 마지막 next()면 done, 순서는 CAPTURE_ORDER', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    const seen: string[] = [];
    c.subscribe((s) => {
      if (s.target && seen[seen.length - 1] !== s.target) seen.push(s.target);
    });
    fillAll(c);
    expect(c.snapshot()).toMatchObject({ phase: 'done', target: null });
    expect(seen).toEqual([...CAPTURE_ORDER]);
    expect(c.completedPads()).toEqual([...CAPTURE_ORDER]);
  });

  it('lastAccepted는 마지막 수락 타격(손·패드·시각)', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    c.onHit(1, P(0, 0), 555);
    expect(c.snapshot().lastAccepted).toEqual({ stickId: 1, pad: 'SNARE', at: 555 });
  });
});

describe('HitCapture 퍼짐 검사', () => {
  it('2타 각도 차가 8°를 넘으면 그 손의 그 패드만 0으로 되돌리고 warning', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    twice(c, 1, -10, 0);
    c.onHit(0, P(-10, 0));
    c.onHit(0, P(-10, 12));
    const s = c.snapshot();
    expect(s.counts).toEqual([0, 2]);
    expect(s.warning).toMatchObject({ pad: 'SNARE', stickId: 0 });
    expect(s.warning?.spread).toBeCloseTo(12 * Math.cos((10 * Math.PI) / 180), 0);
    expect(s.target).toBe('SNARE');
    // 다시 치면 경고가 지워지고 확인 대기
    twice(c, 0, -10, 0);
    expect(c.snapshot()).toMatchObject({ warning: null, phase: 'padDone', target: 'SNARE' });
  });

  it('정확히 8°는 통과', () => {
    const c = new HitCapture({ maxSpreadDeg: 8 });
    c.start([0]);
    c.onHit(0, P(0, 0));
    c.onHit(0, P(0, 8));
    expect(c.snapshot().warning).toBeNull();
    expect(c.snapshot().phase).toBe('padDone');
  });
});

describe('HitCapture 손 추가·제거·redo·restart', () => {
  it('addHand: 보정 중 붙은 손은 현재 패드부터 받고, 지난 패드는 그 손에 비어 있다. 확인 대기 중이면 다시 capturing', () => {
    const c = new HitCapture();
    c.start([0]);
    twice(c, 0, -10, 0); // SNARE 채움 → padDone
    c.next(); // HIHAT
    c.addHand(1);
    expect(c.snapshot().hands).toEqual([0, 1]);
    expect(c.snapshot().target).toBe('HIHAT');
    twice(c, 0, 0, -30);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT' }); // 오른손이 아직
    twice(c, 1, 0, -35);
    expect(c.snapshot().phase).toBe('padDone');
    const built = c.build(DEFAULT_SENSOR_TUNING);
    expect(built[1]?.SNARE).toBeUndefined();
    expect(built[1]?.HIHAT).toBeDefined();

    // 확인 대기 중 손이 붙으면 그 손을 받으려고 capturing으로 돌아간다
    const d = new HitCapture();
    d.start([0]);
    twice(d, 0, -10, 0);
    d.addHand(1);
    expect(d.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', counts: [2, 0] });
  });

  it('dropHand: 손이 빠지면 남은 손이 채운 패드는 확인 대기가 되고, 다 빠지면 done', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    c.dropHand(1);
    expect(c.snapshot()).toMatchObject({ hands: [0], phase: 'padDone', target: 'SNARE' });
    c.dropHand(0);
    expect(c.snapshot().phase).toBe('done');
  });

  it('redo(pad): 그 패드의 모든 손 결과를 지우고 index를 그 패드로. 확인 대기 중 현재 패드 redo = [다시]', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    fillAll(c);
    c.redo('HIHAT');
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', index: 1, counts: [0, 0] });
    expect(c.snapshot().captured.HIHAT).toBeUndefined();
    expect(c.snapshot().captured.SNARE).toBeDefined();
    twice(c, 0, 0, -30);
    twice(c, 1, 0, -35);
    expect(c.snapshot().phase).toBe('padDone');
    c.redo('HIHAT'); // [다시]
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', counts: [0, 0] });
    expect(c.snapshot().captured.HIHAT).toBeUndefined();
  });

  it('restart: 손 목록은 유지하고 처음부터(사용자 반경도 지운다)', () => {
    const c = new HitCapture();
    c.start([1]);
    twice(c, 1, -10, 0);
    c.setRadiusOverride('SNARE', 20);
    c.restart();
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', hands: [1], target: 'SNARE', counts: [0, 0], captured: {}, radiusOverrides: {} });
  });
});

describe('HitCapture build', () => {
  it('손별 앵커 7개, 반경은 튜닝 하한~상한, 대상이 아니던 손은 null', () => {
    const c = new HitCapture();
    c.start([0]);
    CAPTURE_ORDER.forEach((_, i) => {
      twice(c, 0, -10 + i * 5, -40 + i * 12);
      c.next();
    });
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(r).toBeNull();
    expect(Object.keys(l!).sort()).toEqual([...CAPTURE_ORDER].sort());
    for (const a of Object.values(l!)) {
      expect(a!.radius).toBeGreaterThanOrEqual(DEFAULT_SENSOR_TUNING.minRadiusDeg);
      expect(a!.radius).toBeLessThanOrEqual(DEFAULT_SENSOR_TUNING.maxRadiusDeg);
      expect(a!.samples).toBe(2);
    }
    expect(l!.SNARE!.yaw).toBeCloseTo(-39.5);
  });

  it('setRadiusOverride(pad, deg): build가 양손 그 패드 앵커에 radiusOverride를 넣고 반경을 하한~상한으로 자른다(UX-64 D9)', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    twice(c, 0, -10, -40);
    twice(c, 1, -10, -20);
    c.setRadiusOverride('SNARE', 60);
    c.setRadiusOverride('KICK', 20); // 세션 밖 패드는 무시
    expect(c.snapshot().radiusOverrides).toEqual({ SNARE: 60 });
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(l!.SNARE).toMatchObject({ radiusOverride: 60, radius: DEFAULT_SENSOR_TUNING.maxRadiusDeg });
    expect(r!.SNARE).toMatchObject({ radiusOverride: 60, radius: DEFAULT_SENSOR_TUNING.maxRadiusDeg });
  });
});

describe('HitCapture 패드 단위(T9)', () => {
  it('start(hands, order)는 그 패드들만 받고 스냅샷 order에 남는다. restart도 order 유지', () => {
    const c = new HitCapture();
    c.start([0, 1], ['HIHAT']);
    expect(c.snapshot()).toMatchObject({ target: 'HIHAT', order: ['HIHAT'] });
    twice(c, 0, 0, -30);
    c.restart();
    expect(c.snapshot()).toMatchObject({ target: 'HIHAT', order: ['HIHAT'], counts: [0, 0] });
    twice(c, 0, 0, -30);
    twice(c, 1, 0, -35);
    expect(c.snapshot().phase).toBe('padDone');
    c.next();
    expect(c.snapshot().phase).toBe('done');
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(Object.keys(l!)).toEqual(['HIHAT']);
    expect(Object.keys(r!)).toEqual(['HIHAT']);
  });

  it('전체 순서에 없는 패드는 걸러지고, 비면 바로 done', () => {
    const c = new HitCapture();
    c.start([0], ['KICK']);
    expect(c.snapshot().phase).toBe('done');
  });
});
