// 2타 보정 상태 기계 검증(PLAY-004 3-5, UX-64 D3, 보정 흐름 개편): 순서·손별 2타·자동 진행(지연)·간격 경고(멈추지 않음·다음 첫 수락 타격에서 비움, v0.2)·
// next(외부 호출용)·redo(done에서도)·base 스냅샷·base(재보정)·손별 독립 비교·퍼짐 되돌림·손 추가/제거·restart·build.
import { describe, expect, it, vi } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import { CAPTURE_ORDER, HitCapture } from './HitCapture';
import { DEFAULT_SENSOR_TUNING } from '@/domain/kit/calibration/tuning';
import type { HandAnchors } from '@/domain/kit/calibration/calibration';

/** 지연 없이 동기 진행하는 캡처(타이머가 필요 없는 테스트용) */
const sync = () => new HitCapture({ advanceDelayMs: 0 });
const anchorOf = (pad: PadId, pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 18, samples: 2, spread: 1 });

const P = (pitch: number, yaw: number) => ({ pitch, yaw });

/** 손 h가 자세 p로 두 번 친다(두 번째는 1° 옆) */
function twice(c: HitCapture, h: 0 | 1, pitch: number, yaw: number) {
  expect(c.onHit(h, P(pitch, yaw), 100)).toBe(true);
  expect(c.onHit(h, P(pitch, yaw + 1), 200)).toBe(true);
}

/** 순서대로 7패드를 양손 모두 채운다(패드끼리 약 30° 떨어져 경고 없음 → 자동 진행). 손마다 다른 자리 */
function fillAll(c: HitCapture) {
  CAPTURE_ORDER.forEach((pad, i) => {
    // 라이드는 오른손만 받는다(PLAY-004 ①)
    if (pad !== 'RIDE') twice(c, 0, -10 + i * 5, -40 + i * 30);
    twice(c, 1, -10 + i * 5, -20 + i * 30);
  });
}

describe('HitCapture 순서·카운트', () => {
  it('보정 순서는 하이햇 → 크래시 → 스네어 → 스몰탐 → 미드탐 → 플로어탐 → 라이드', () => {
    expect([...CAPTURE_ORDER]).toEqual(['HIHAT', 'CRASH', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE']);
  });

  it('시작하면 capturing·하이햇이 목표, 카운트 0, 경고·advancing 없음', () => {
    const c = new HitCapture();
    c.start([0, 1]);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', index: 0, counts: [0, 0], hands: [0, 1], radiusOverrides: {}, gapWarnings: [], advancing: false });
  });

  it('손 목록이 비면 바로 done', () => {
    const c = new HitCapture();
    c.start([]);
    expect(c.snapshot().phase).toBe('done');
  });

  it('양손 2타씩 채우면 경고가 없을 때 자동으로 다음 패드로 간다. 한 손만 채우면 그대로', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', counts: [2, 0] });
    twice(c, 1, -10, 5);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH', index: 1, counts: [0, 0], gapWarnings: [] });
    expect(c.snapshot().captured.HIHAT?.[0]).toMatchObject({ pad: 'HIHAT', samples: 2 });
    expect(c.snapshot().captured.HIHAT?.[0]?.yaw).toBeCloseTo(0.5);
  });

  it('자동 진행은 400ms 지연: 그동안 padDone·advancing이고 타격은 무시, 지나면 다음 패드', () => {
    vi.useFakeTimers();
    try {
      const c = new HitCapture();
      c.start([0]);
      twice(c, 0, -10, 0);
      expect(c.snapshot()).toMatchObject({ phase: 'padDone', advancing: true, target: 'HIHAT', gapWarnings: [] });
      expect(c.onHit(0, P(0, 50))).toBe(false);
      vi.advanceTimersByTime(399);
      expect(c.snapshot().phase).toBe('padDone');
      vi.advanceTimersByTime(1);
      expect(c.snapshot()).toMatchObject({ phase: 'capturing', advancing: false, target: 'CRASH', counts: [0, 0] });
      expect(c.onHit(0, P(0, 50))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('지연 중 redo·start·cancel은 타이머를 정리해 뒤늦게 진행하지 않는다', () => {
    vi.useFakeTimers();
    try {
      const c = new HitCapture();
      c.start([0]);
      twice(c, 0, -10, 0);
      c.redo('HIHAT');
      vi.advanceTimersByTime(1000);
      expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', advancing: false });
      twice(c, 0, -10, 0);
      c.start([0]);
      vi.advanceTimersByTime(1000);
      expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', advancing: false });
      twice(c, 0, -10, 0);
      c.cancel();
      vi.advanceTimersByTime(1000);
      expect(c.snapshot()).toMatchObject({ phase: 'idle', advancing: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('padDone이 아닐 때 next()는 무동작', () => {
    const c = sync();
    c.start([0]);
    c.next();
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT', index: 0 });
  });

  it('이미 2타를 채운 손의 타격은 무시(false), 대상이 아닌 손도 무시', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    expect(c.onHit(0, P(-10, 0))).toBe(false); // 왼손은 찼고 오른손을 기다리는 중
    expect(c.snapshot().counts).toEqual([2, 0]);
    const one = sync();
    one.start([0]);
    expect(one.onHit(1, P(-10, 0))).toBe(false); // 대상이 아닌 손
    twice(one, 0, -10, 0);
    // 한 손만 대상이면 그 손이 채우는 순간 다음 패드
    expect(one.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH' });
  });

  it('7패드를 다 채우면 버튼 없이 done, 순서는 CAPTURE_ORDER', () => {
    const c = sync();
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
    expect(c.snapshot().lastAccepted).toEqual({ stickId: 1, pad: 'HIHAT', at: 555 });
  });
});

describe('HitCapture 퍼짐 검사', () => {
  it('2타 각도 차가 8°를 넘으면 그 손의 그 패드만 0으로 되돌리고 warning(자동 진행 안 함)', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 1, -10, 0);
    c.onHit(0, P(-10, 0));
    c.onHit(0, P(-10, 12));
    const s = c.snapshot();
    expect(s.counts).toEqual([0, 2]);
    expect(s.warning).toMatchObject({ pad: 'HIHAT', stickId: 0 });
    expect(s.warning?.spread).toBeCloseTo(12 * Math.cos((10 * Math.PI) / 180), 0);
    expect(s.target).toBe('HIHAT');
    expect(s.phase).toBe('capturing');
    // 다시 치면 경고가 지워지고 다음 패드
    twice(c, 0, -10, 0);
    expect(c.snapshot()).toMatchObject({ warning: null, phase: 'capturing', target: 'CRASH' });
  });

  it('정확히 8°는 통과', () => {
    const c = new HitCapture({ maxSpreadDeg: 8, advanceDelayMs: 0 });
    c.start([0]);
    c.onHit(0, P(0, 0));
    c.onHit(0, P(0, 8));
    expect(c.snapshot().warning).toBeNull();
    expect(c.snapshot().target).toBe('CRASH');
  });
});

describe('HitCapture 간격 경고(멈추지 않는 배너, v0.2)', () => {
  it('경고가 있어도 경고 없는 경우와 똑같이 400ms 뒤 자동 진행하고, 경고는 남는다', () => {
    vi.useFakeTimers();
    try {
      const c = new HitCapture();
      c.start([0]);
      twice(c, 0, 0, 0); // HIHAT (평균 yaw 0.5)
      vi.advanceTimersByTime(400);
      expect(c.snapshot().target).toBe('CRASH');
      twice(c, 0, 0, 10); // CRASH: 약 10° 옆
      const s = c.snapshot();
      expect(s.phase).toBe('padDone');
      expect(s.advancing).toBe(true);
      expect(s.target).toBe('CRASH');
      expect(s.gapWarnings).toHaveLength(1);
      expect(s.gapWarnings[0]).toMatchObject({ stickId: 0, pad: 'CRASH', near: 'HIHAT' });
      expect(s.gapWarnings[0].deg).toBeCloseTo(10, 0);
      expect(c.onHit(0, P(0, 0))).toBe(false); // 지연 중에는 타격 무시
      vi.advanceTimersByTime(399);
      expect(c.snapshot().phase).toBe('padDone');
      vi.advanceTimersByTime(1);
      expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', advancing: false, counts: [0, 0] });
      expect(c.snapshot().gapWarnings).toHaveLength(1); // 자동 진행해도 경고는 유지
      expect(c.snapshot().gapWarnings[0]).toMatchObject({ pad: 'CRASH', near: 'HIHAT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('유지된 경고는 다음 패드의 첫 수락 타격에서 비운다(손 하나가 먼저 쳐도)', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, 0, 0);
    twice(c, 1, 0, 0);
    twice(c, 0, 0, 10);
    twice(c, 1, 0, 10); // CRASH 양손 경고 → 즉시 SNARE
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE' });
    expect(c.snapshot().gapWarnings).toHaveLength(2);
    expect(c.onHit(1, P(0, 90), 300)).toBe(true);
    expect(c.snapshot().gapWarnings).toEqual([]);
    expect(c.snapshot().counts).toEqual([0, 1]);
  });

  it('수락되지 않은 타격(대상 아닌 손)은 경고를 비우지 않는다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, 0);
    twice(c, 0, 0, 10);
    expect(c.onHit(1, P(0, 90))).toBe(false);
    expect(c.snapshot().gapWarnings).toHaveLength(1);
  });

  it('가장 가까운 패드가 near. 기준(minGapDeg) 이상이면 경고하지 않는다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, 0); // HIHAT
    twice(c, 0, 0, 40); // CRASH (멀다)
    expect(c.snapshot().gapWarnings).toEqual([]);
    twice(c, 0, 0, 55); // SNARE: HIHAT과 약 55°, CRASH와 약 15°
    const s = c.snapshot();
    expect(s.target).toBe('SMALL_TOM');
    expect(s.gapWarnings[0]).toMatchObject({ pad: 'SNARE', near: 'CRASH' });
    const ok = new HitCapture({ advanceDelayMs: 0, minGapDeg: 10 });
    ok.start([0]);
    twice(ok, 0, 0, 0);
    twice(ok, 0, 0, 15);
    expect(ok.snapshot().gapWarnings).toEqual([]); // 10° 기준이면 15°는 통과
  });

  it('next()는 계속 쓸 수 있다: 지연 중 바로 다음 패드로(경고는 유지)', () => {
    vi.useFakeTimers();
    try {
      const c = new HitCapture();
      c.start([0]);
      twice(c, 0, 0, 0);
      vi.advanceTimersByTime(400);
      twice(c, 0, 0, 10);
      expect(c.snapshot().phase).toBe('padDone');
      c.next();
      expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', counts: [0, 0] });
      expect(c.snapshot().gapWarnings).toHaveLength(1);
      expect(c.snapshot().captured.CRASH?.[0]).toBeDefined(); // 저장을 막지 않는다
    } finally {
      vi.useRealTimers();
    }
  });

  it('redo는 경고를 비우고 그 패드만 다시 받는다. 다시 쳐서 경고가 없으면 순서상 안 끝난 첫 패드로 간다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, 0);
    twice(c, 0, 0, 10);
    expect(c.snapshot().gapWarnings).toHaveLength(1);
    c.redo('CRASH'); // 배너의 [크래시 다시]
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH', gapWarnings: [], counts: [0, 0] });
    expect(c.snapshot().captured.CRASH).toBeUndefined();
    expect(c.snapshot().captured.HIHAT).toBeDefined();
    twice(c, 0, 0, 60);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', gapWarnings: [] });
  });

  it('start·restart·cancel도 경고를 비운다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, 0);
    twice(c, 0, 0, 10);
    expect(c.snapshot().gapWarnings).toHaveLength(1);
    c.restart();
    expect(c.snapshot().gapWarnings).toEqual([]);
    twice(c, 0, 0, 0);
    twice(c, 0, 0, 10);
    c.cancel();
    expect(c.snapshot()).toMatchObject({ phase: 'idle', gapWarnings: [] });
    c.start([0]);
    twice(c, 0, 0, 0);
    twice(c, 0, 0, 10);
    c.start([0]);
    expect(c.snapshot().gapWarnings).toEqual([]);
  });

  it('손별로 따로 비교한다: 왼손은 가깝고 오른손은 멀면 왼손만 경고', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, 0, 0);
    twice(c, 1, 0, 0); // HIHAT 양손 같은 자리
    twice(c, 0, 0, 10); // CRASH 왼손: HIHAT과 10°
    twice(c, 1, 0, 60); // CRASH 오른손: 60°. 왼손 앵커(0°)와 비교하지 않는다
    const s = c.snapshot();
    expect(s.target).toBe('SNARE');
    expect(s.gapWarnings).toHaveLength(1);
    expect(s.gapWarnings[0]).toMatchObject({ stickId: 0, near: 'HIHAT' });
  });

  it('다른 손 앵커와는 비교하지 않는다(왼손 CRASH가 오른손 HIHAT과 같은 자리여도 경고 없음)', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, 0, -60);
    twice(c, 1, 0, 0); // 오른손 HIHAT 0°
    twice(c, 0, 0, 0); // 왼손 CRASH 0°(왼손 HIHAT은 -60°)
    twice(c, 1, 0, 60);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', gapWarnings: [] });
  });

  it('패드 단위 재보정: base(세션 밖 패드)의 같은 손 앵커와 비교한다. 세션 안 패드의 base 값은 쓰지 않는다', () => {
    const base: HandAnchors = [{ SNARE: anchorOf('SNARE', 0, 0), HIHAT: anchorOf('HIHAT', 0, 100) }, { SNARE: anchorOf('SNARE', 0, 50) }];
    const c = sync();
    c.start([0, 1], ['HIHAT'], base);
    twice(c, 0, 0, 105); // 옛 HIHAT 자리(100°)는 base에서 제외 → 경고 아님. 스네어(0°)와는 멀다
    twice(c, 1, 0, 100);
    expect(c.snapshot()).toMatchObject({ phase: 'done', gapWarnings: [] });

    const d = sync();
    d.start([0, 1], ['HIHAT'], base);
    twice(d, 0, 0, 10); // 왼손 스네어(0°)와 10°
    twice(d, 1, 0, 100); // 오른손: 스네어(50°)와 멀다
    const s = d.snapshot();
    // 마지막 패드에서 경고가 나도 done으로 가고, 경고는 남아 있다
    expect(s.phase).toBe('done');
    expect(s.gapWarnings).toHaveLength(1);
    expect(s.gapWarnings[0]).toMatchObject({ stickId: 0, pad: 'HIHAT', near: 'SNARE' });
  });

  it('base 스냅샷: 시작에서 준 세션 밖 앵커를 내보낸다. 없으면 [null, null]', () => {
    const base: HandAnchors = [{ SNARE: anchorOf('SNARE', 0, 0) }, null];
    const c = sync();
    expect(c.snapshot().base).toEqual([null, null]);
    c.start([0], ['HIHAT'], base);
    expect(c.snapshot().base).toEqual(base);
    c.start([0]);
    expect(c.snapshot().base).toEqual([null, null]);
  });

  it('restart도 base를 유지한다', () => {
    const base: HandAnchors = [{ SNARE: anchorOf('SNARE', 0, 0) }, null];
    const c = sync();
    c.start([0], ['HIHAT'], base);
    c.restart();
    expect(c.snapshot().base).toEqual(base);
    twice(c, 0, 0, 10);
    expect(c.snapshot().gapWarnings[0]).toMatchObject({ near: 'SNARE' });
  });
});

describe('HitCapture 결과 화면(done)에서 다시 치기', () => {
  it('done에서 redo(pad)하면 그 패드만 받고, 끝나면 done으로 돌아온다', () => {
    const c = sync();
    c.start([0, 1]);
    fillAll(c);
    expect(c.snapshot().phase).toBe('done');
    const before = c.snapshot().captured;
    c.redo('SNARE');
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE', counts: [0, 0] });
    expect(c.snapshot().captured.SNARE).toBeUndefined();
    twice(c, 0, 20, 5);
    twice(c, 1, 20, 8); // 다른 패드와 20° 이상 떨어진 자리
    expect(c.snapshot().phase).toBe('done');
    expect(c.snapshot().captured.HIHAT).toEqual(before.HIHAT);
    expect(c.snapshot().captured.SNARE?.[0]).toBeDefined();
  });

  it('done에서 다시 친 패드가 경고여도 done으로 돌아오고 경고는 남는다', () => {
    const c = sync();
    c.start([0, 1]);
    fillAll(c);
    c.redo('SNARE');
    twice(c, 0, -10, -40 + 1); // HIHAT 자리(-40 부근)
    twice(c, 1, -10 + 10, -20 + 60);
    expect(c.snapshot().phase).toBe('done');
    expect(c.snapshot().gapWarnings[0]).toMatchObject({ stickId: 0, pad: 'SNARE', near: 'HIHAT' });
  });

  it('중간 패드를 redo해도 끝나면 순서상 안 끝난 첫 패드(없으면 done)로 간다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, 0); // HIHAT
    twice(c, 0, 0, 40); // CRASH
    c.redo('HIHAT');
    twice(c, 0, 0, 0);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'SNARE' }); // CRASH는 끝났으므로 건너뜀
  });
});

describe('HitCapture 손 추가·제거·redo·restart', () => {
  it('addHand: 보정 중 붙은 손은 현재 패드부터 받고, 지난 패드는 그 손에 비어 있다. 확인 대기 중이면 다시 capturing', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, -10, 0); // HIHAT 채움 → CRASH
    c.addHand(1);
    expect(c.snapshot().hands).toEqual([0, 1]);
    expect(c.snapshot().target).toBe('CRASH');
    twice(c, 0, 0, -50);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH' }); // 오른손이 아직
    twice(c, 1, 0, -35);
    expect(c.snapshot().target).toBe('SNARE');
    const built = c.build(DEFAULT_SENSOR_TUNING);
    expect(built[1]?.HIHAT).toBeUndefined();
    expect(built[1]?.CRASH).toBeDefined();

    // 확인 대기(자동 진행 지연) 중 손이 붙으면 그 손을 받으려고 capturing으로 돌아간다(경고 지움, 타이머 해제)
    vi.useFakeTimers();
    try {
      const d = new HitCapture();
      d.start([0]);
      twice(d, 0, -10, 0);
      vi.advanceTimersByTime(400);
      twice(d, 0, -10, 5); // CRASH: 경고 → padDone(자동 진행 대기)
      expect(d.snapshot()).toMatchObject({ phase: 'padDone', advancing: true });
      d.addHand(1);
      expect(d.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH', counts: [2, 0], gapWarnings: [], advancing: false });
      vi.advanceTimersByTime(1000);
      expect(d.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('dropHand: 손이 빠지면 남은 손이 채운 패드는 다음으로 넘어가고, 다 빠지면 done', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, -10, 0);
    c.dropHand(1);
    expect(c.snapshot()).toMatchObject({ hands: [0], phase: 'capturing', target: 'CRASH' });
    c.dropHand(0);
    expect(c.snapshot().phase).toBe('done');
  });

  it('redo(pad): 그 패드의 모든 손 결과를 지우고 index를 그 패드로', () => {
    const c = sync();
    c.start([0, 1]);
    fillAll(c);
    c.redo('CRASH');
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'CRASH', index: 1, counts: [0, 0] });
    expect(c.snapshot().captured.CRASH).toBeUndefined();
    expect(c.snapshot().captured.HIHAT).toBeDefined();
  });

  it('restart: 손 목록은 유지하고 처음부터(사용자 반경도 지운다)', () => {
    const c = sync();
    c.start([1]);
    twice(c, 1, -10, 0);
    c.setRadiusOverride('SNARE', 20);
    c.restart();
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', hands: [1], target: 'HIHAT', counts: [0, 0], captured: {}, radiusOverrides: {}, gapWarnings: [] });
  });
});

describe('HitCapture build', () => {
  it('손별 앵커 7개, 반경은 튜닝 하한~상한, 대상이 아니던 손은 null', () => {
    const c = sync();
    c.start([0]);
    CAPTURE_ORDER.forEach((_, i) => twice(c, 0, -10 + i * 5, -40 + i * 30));
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(r).toBeNull();
    expect(Object.keys(l!).sort()).toEqual([...CAPTURE_ORDER].sort());
    for (const a of Object.values(l!)) {
      expect(a!.radius).toBeGreaterThanOrEqual(DEFAULT_SENSOR_TUNING.minRadiusDeg);
      expect(a!.radius).toBeLessThanOrEqual(DEFAULT_SENSOR_TUNING.maxRadiusDeg);
      expect(a!.samples).toBe(2);
    }
    expect(l!.HIHAT!.yaw).toBeCloseTo(-39.5);
  });

  it('setRadiusOverride(pad, deg): build가 양손 그 패드 앵커에 radiusOverride를 넣고 반경을 하한~상한으로 자른다(UX-64 D9)', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 0, -10, -40);
    twice(c, 1, -10, -20);
    c.setRadiusOverride('HIHAT', 60);
    c.setRadiusOverride('KICK', 20); // 세션 밖 패드는 무시
    expect(c.snapshot().radiusOverrides).toEqual({ HIHAT: 60 });
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(l!.HIHAT).toMatchObject({ radiusOverride: 60, radius: DEFAULT_SENSOR_TUNING.maxRadiusDeg });
    expect(r!.HIHAT).toMatchObject({ radiusOverride: 60, radius: DEFAULT_SENSOR_TUNING.maxRadiusDeg });
  });
});

describe('HitCapture 패드 단위(T9)', () => {
  it('start(hands, order)는 그 패드들만 받고 스냅샷 order에 남는다. restart도 order 유지', () => {
    const c = sync();
    c.start([0, 1], ['HIHAT']);
    expect(c.snapshot()).toMatchObject({ target: 'HIHAT', order: ['HIHAT'] });
    twice(c, 0, 0, -30);
    c.restart();
    expect(c.snapshot()).toMatchObject({ target: 'HIHAT', order: ['HIHAT'], counts: [0, 0] });
    twice(c, 0, 0, -30);
    twice(c, 1, 0, -35);
    expect(c.snapshot().phase).toBe('done');
    const [l, r] = c.build(DEFAULT_SENSOR_TUNING);
    expect(Object.keys(l!)).toEqual(['HIHAT']);
    expect(Object.keys(r!)).toEqual(['HIHAT']);
  });

  it('전체 순서에 없는 패드는 걸러지고, 비면 바로 done', () => {
    const c = sync();
    c.start([0], ['KICK']);
    expect(c.snapshot().phase).toBe('done');
  });
});

describe('HitCapture 패드별 보정 손(PLAY-004 ①)', () => {
  /** 라이드 차례까지 양손으로 6패드를 채운다 */
  function toRide(c: HitCapture) {
    CAPTURE_ORDER.slice(0, 6).forEach((_, i) => {
      twice(c, 0, -10 + i * 5, -40 + i * 30);
      twice(c, 1, -10 + i * 5, -20 + i * 30);
    });
  }

  it('양손 세션에서 라이드는 오른손 2타만으로 끝나고, 스냅샷 targetHands는 [1]', () => {
    const c = sync();
    c.start([0, 1]);
    expect(c.snapshot().targetHands).toEqual([0, 1]);
    toRide(c);
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'RIDE', targetHands: [1] });
    twice(c, 1, 20, 80);
    expect(c.snapshot().phase).toBe('done');
    expect(c.snapshot().captured.RIDE?.[0]).toBeUndefined();
    expect(c.snapshot().captured.RIDE?.[1]).toMatchObject({ pad: 'RIDE', samples: 2 });
    expect(c.completedPads()).toContain('RIDE');
  });

  it('라이드 중 왼손 타격은 받지 않고 wrongHand를 남긴다. 오른손이 치면 지운다', () => {
    const c = sync();
    c.start([0, 1]);
    toRide(c);
    expect(c.onHit(0, P(20, 80), 500)).toBe(false);
    expect(c.snapshot().wrongHand).toEqual({ pad: 'RIDE', stickId: 0, at: 500 });
    expect(c.snapshot().counts).toEqual([0, 0]);
    expect(c.onHit(1, P(20, 80), 600)).toBe(true);
    expect(c.snapshot().wrongHand).toBeNull();
  });

  it('패드가 넘어가면 wrongHand를 지운다', () => {
    const c = sync();
    c.start([0, 1], ['RIDE', 'SNARE']);
    c.onHit(0, P(0, 0), 10);
    expect(c.snapshot().wrongHand).not.toBeNull();
    twice(c, 1, 20, 80);
    expect(c.snapshot()).toMatchObject({ target: 'SNARE', wrongHand: null });
  });

  it('다른 패드는 지금처럼 양손이 채워야 끝난다', () => {
    const c = sync();
    c.start([0, 1]);
    twice(c, 1, -10, 0);
    expect(c.snapshot()).toMatchObject({ target: 'HIHAT', phase: 'capturing', wrongHand: null });
    twice(c, 0, -10, -40);
    expect(c.snapshot().target).toBe('CRASH');
  });

  it('왼손만 세션이면 라이드를 왼손이 받는다', () => {
    const c = sync();
    c.start([0], ['RIDE']);
    expect(c.snapshot().targetHands).toEqual([0]);
    twice(c, 0, 20, 80);
    expect(c.snapshot().phase).toBe('done');
    expect(c.capturedHands()).toEqual([{ pad: 'RIDE', hands: [0] }]);
  });

  it('capturedHands: 패드별로 실제 친 손', () => {
    const c = sync();
    c.start([0, 1]);
    fillAll(c);
    const m = new Map(c.capturedHands().map((e) => [e.pad, e.hands]));
    expect(m.get('SNARE')).toEqual([0, 1]);
    expect(m.get('RIDE')).toEqual([1]);
    expect(c.capturedHands()).toHaveLength(7);
  });

  it('라이드 단계에 왼손이 새로 붙어도 오른손이 이미 채웠으면 바로 done을 유지한다', () => {
    const c = sync();
    c.start([1], ['RIDE']);
    twice(c, 1, 20, 80);
    expect(c.snapshot().phase).toBe('done');
    c.addHand(0);
    expect(c.snapshot().phase).toBe('done');
  });

  it('checkGaps: base의 derived 앵커는 간격 경고 비교에서 뺀다', () => {
    const c = sync();
    const base: HandAnchors = [{ RIDE: { ...anchorOf('RIDE', 0, 5), derived: true } }, null];
    c.start([0], ['SNARE'], base);
    twice(c, 0, 0, 0);
    expect(c.snapshot().gapWarnings).toEqual([]);
    const c2 = sync();
    c2.start([0], ['SNARE'], [{ RIDE: anchorOf('RIDE', 0, 5) }, null]);
    twice(c2, 0, 0, 0);
    expect(c2.snapshot().gapWarnings).toHaveLength(1);
  });
});

describe('HitCapture 타격 세기 표본(PLAY-004 ③)', () => {
  it('손별로 쌓이고 받을 손이 아닌 손·다시 친 것도 포함하며 비정상 값은 뺀다', () => {
    const c = sync();
    c.start([0, 1], ['RIDE']);
    c.onHit(1, P(20, 80), 2, 800);
    c.onHit(0, P(0, 0), 3, NaN); // 받을 손이 아닌 손의 비정상 값
    c.onHit(0, P(0, 0), 4, 0);
    c.onHit(0, P(0, 0), 5, -5);
    c.onHit(0, P(0, 0), 6);
    c.onHit(0, P(0, 0), 7, 700); // 받을 손 아님이어도 쌓는다
    expect(c.peakSpeeds()).toEqual([[700], [800]]);
  });

  it('퍼짐 때문에 되돌린 타격도 쌓는다', () => {
    const c = sync();
    c.start([1], ['SNARE']);
    c.onHit(1, P(0, 0), 1, 500);
    c.onHit(1, P(0, 40), 2, 600); // 퍼짐 초과 → 되돌림
    expect(c.snapshot().warning).not.toBeNull();
    expect(c.peakSpeeds()[1]).toEqual([500, 600]);
  });

  it('restart는 비우고, 읽은 배열을 고쳐도 내부는 그대로', () => {
    const c = sync();
    c.start([1], ['SNARE']);
    c.onHit(1, P(0, 0), 1, 500);
    c.peakSpeeds()[1].push(1);
    expect(c.peakSpeeds()[1]).toEqual([500]);
    c.restart();
    expect(c.peakSpeeds()).toEqual([[], []]);
  });
});

describe('HitCapture 실수 안내용 기록(v0.4)', () => {
  it('spreadStreak: 퍼짐 경고가 날 때마다 그 손만 오르고, 그 손이 채우면 0', () => {
    const c = sync();
    c.start([0, 1]);
    expect(c.snapshot().spreadStreak).toEqual([0, 0]);
    c.onHit(0, P(0, -40), 100);
    c.onHit(0, P(0, -20), 200); // 20° 퍼짐 → 되돌림
    expect(c.snapshot().spreadStreak).toEqual([1, 0]);
    c.onHit(0, P(0, -40), 300);
    expect(c.snapshot().spreadStreak).toEqual([1, 0]); // 다시 치는 첫 타격으로는 지우지 않는다
    c.onHit(0, P(0, -20), 400);
    expect(c.snapshot().spreadStreak).toEqual([2, 0]);
    twice(c, 0, 0, -40);
    expect(c.snapshot().spreadStreak).toEqual([0, 0]);
  });

  it('spreadStreak: 패드가 넘어가거나 redo·restart하면 0', () => {
    const c = sync();
    c.start([1]);
    c.onHit(1, P(0, -40), 100);
    c.onHit(1, P(0, -20), 200);
    expect(c.snapshot().spreadStreak).toEqual([0, 1]);
    twice(c, 1, 0, -40); // 하이햇 끝 → 크래시
    expect(c.snapshot()).toMatchObject({ target: 'CRASH', spreadStreak: [0, 0] });
    c.onHit(1, P(30, 0), 300);
    c.onHit(1, P(30, 20), 400);
    expect(c.snapshot().spreadStreak).toEqual([0, 1]);
    c.redo('CRASH');
    expect(c.snapshot().spreadStreak).toEqual([0, 0]);
    c.onHit(1, P(30, 0), 500);
    c.onHit(1, P(30, 20), 600);
    c.restart();
    expect(c.snapshot().spreadStreak).toEqual([0, 0]);
  });

  it('gapHints: 이웃과 가까웠던 패드를 redo하면 손·이웃·각도를 남기고, 그 패드가 채워져 넘어가면 비운다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, -40); // 하이햇
    twice(c, 0, 0, -32); // 크래시: 하이햇과 8°
    expect(c.snapshot()).toMatchObject({ target: 'SNARE', gapHints: [] });
    c.redo('CRASH');
    const hints = c.snapshot().gapHints;
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ stickId: 0, pad: 'CRASH', near: 'HIHAT' });
    expect(hints[0].deg).toBeLessThan(20);
    c.onHit(0, P(30, 0), 100);
    expect(c.snapshot().gapHints).toHaveLength(1); // 치는 동안은 남는다
    c.onHit(0, P(30, 1), 200);
    expect(c.snapshot()).toMatchObject({ target: 'SNARE', gapHints: [] });
  });

  it('gapHints: 멀리 떨어진 패드를 redo하면 비어 있고, 다른 redo·cancel에서도 비운다', () => {
    const c = sync();
    c.start([0]);
    twice(c, 0, 0, -40);
    twice(c, 0, 0, -32);
    twice(c, 0, -30, 40); // 스네어: 멀다
    c.redo('SNARE');
    expect(c.snapshot().gapHints).toEqual([]);
    c.redo('CRASH');
    expect(c.snapshot().gapHints).toHaveLength(1);
    c.redo('SNARE');
    expect(c.snapshot().gapHints).toEqual([]);
    c.redo('CRASH');
    expect(c.snapshot().gapHints).toEqual([]); // 크래시는 앞 redo에서 지워져 비교할 앵커가 없다
    c.cancel();
    expect(c.snapshot().gapHints).toEqual([]);
  });

  it('gapHints: 결과 화면(done)에서 redo해도 남긴다', () => {
    const c = sync();
    c.start([0], ['HIHAT', 'CRASH']);
    twice(c, 0, 0, -40);
    twice(c, 0, 0, -32);
    expect(c.snapshot().phase).toBe('done');
    c.redo('HIHAT');
    expect(c.snapshot()).toMatchObject({ phase: 'capturing', target: 'HIHAT' });
    expect(c.snapshot().gapHints[0]).toMatchObject({ pad: 'HIHAT', near: 'CRASH' });
  });
});
