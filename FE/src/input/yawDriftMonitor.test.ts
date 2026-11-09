import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationProfile, PadAnchor, YawDriftStatus } from '@/domain/calibration';
import type { InputSourceKind, ResolvedHit, SourceState, StickId } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { BaseInputSource } from './InputSource';
import { packetTap } from './packetTap';
import { yawDriftMonitor } from './yawDriftMonitor';

/** BLE형: stickId를 받아 기록한다 */
class MockSource extends BaseInputSource {
  readonly kind = 'ble' as InputSourceKind;
  readonly label = 'mock';
  sent: { bytes: Uint8Array; stickId?: StickId }[] = [];
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    this.sent.push({ bytes, stickId });
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

/** sendCommand가 없는 소스(포인터와 같은 조건) */
class NoCmdSource extends BaseInputSource {
  readonly kind = 'pointer' as InputSourceKind;
  readonly label = 'nocmd';
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

const anchor = (pad: PadId, yaw: number): PadAnchor => ({ pad, pitch: 10, yaw, radius: 10, samples: 0, spread: 0 });
const profile = { anchors: { SNARE: anchor('SNARE', -27) } } as unknown as CalibrationProfile;

const hit = (errDeg: number, over: Partial<ResolvedHit> = {}): ResolvedHit =>
  ({
    id: 1,
    stickId: 0,
    pad: 'SNARE',
    velocity: 80,
    tHit: 0,
    tRecv: 0,
    tResolved: 0,
    source: 'ble',
    pose: { pitch: 10, yaw: -27 + errDeg },
    peakAccel: 0,
    judgedBy: 'stick',
    ...over,
  }) as ResolvedHit;

const feed = (errs: number[]) => {
  for (const e of errs) yawDriftMonitor.observe(hit(e), profile);
};

const PARAM_ACK_YAW_OFFSET = 0x21;
const ack = (value: number, stickId: 0 | 1 | null = null) =>
  packetTap.publish({
    dir: 'in',
    transport: 'ble',
    stickId,
    bytes: new Uint8Array([0x06, 0, PARAM_ACK_YAW_OFFSET, value & 0xff, (value >> 8) & 0xff]),
    recvTime: 0,
  });

/** 송신 바이트의 i16 값(도) */
const sentDeg = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getInt16(1, true) / 100;

let last: [YawDriftStatus | null, YawDriftStatus | null];

beforeEach(() => {
  vi.useFakeTimers();
  yawDriftMonitor.resetAll();
  last = [null, null];
  yawDriftMonitor.onStatus((id, st) => {
    last[id] = st;
  });
});
afterEach(() => {
  yawDriftMonitor.resetAll();
  vi.useRealTimers();
});

const connected = () => {
  const src = new MockSource();
  yawDriftMonitor.setSource(src);
  src.set('connected');
  return src;
};

const NINE_PLUS6 = [6, 6.5, 5.5, 6, 6.2, 5.8, 6, 6.1, 5.9];

describe('yawDriftMonitor', () => {
  it('+6° 안팎 9개 → SET_YAW_OFFSET 1패킷(−6°), 링이 비고 10초 안에는 재송신 없음', () => {
    const src = connected();
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(1);
    expect(src.sent[0].bytes[0]).toBe(0x16);
    expect(Math.abs(sentDeg(src.sent[0].bytes) - -6)).toBeLessThanOrEqual(0.5);
    expect(src.sent[0].stickId).toBe(0);
    // 8번째 샘플에서 송신하고 링을 비우므로 9번째 하나만 남는다
    expect(last[0]?.samples).toBe(1);
    // 쿨다운 중에는 같은 오차가 다시 쌓여도 보내지 않는다
    vi.advanceTimersByTime(5000);
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(1);
    expect(last[0]?.lastErrorDeg).not.toBeNull();
  });

  it('쿨다운이 지나면 다시 보낼 수 있다', () => {
    const src = connected();
    feed(NINE_PLUS6);
    vi.advanceTimersByTime(10_001);
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(2);
  });

  it('PARAM_ACK 0x21 value −600 → appliedDeg −6, acked true', () => {
    connected();
    feed(NINE_PLUS6);
    expect(last[0]?.acked).toBeNull();
    ack(-600, 0);
    expect(last[0]).toMatchObject({ appliedDeg: -6, acked: true });
  });

  it('MAD > 5°면 송신 없음, |중앙값| < 6°여도 송신 없음', () => {
    const src = connected();
    feed([20, -10, 25, -8, 22, -12, 18, -9, 24]);
    expect(src.sent).toHaveLength(0);
    yawDriftMonitor.reset();
    feed([3, 3.5, 2.5, 3, 3.2, 2.8, 3, 3.1, 2.9]);
    expect(src.sent.filter((s) => s.bytes[0] === 0x16)).toHaveLength(0);
    expect(last[0]?.lastErrorDeg).toBeCloseTo(3, 0);
  });

  it('키보드·preview·pad null·judgedBy pose && !inside 타격은 샘플에 들어가지 않는다', () => {
    const src = connected();
    const bad: Partial<ResolvedHit>[] = [
      { source: 'keyboard' as InputSourceKind },
      { source: 'preview' as InputSourceKind },
      { pad: null },
      { judgedBy: 'pose', inside: false },
      { judgedBy: 'pose' },
      { judgedBy: 'key' },
    ];
    for (const o of bad) for (let k = 0; k < 9; k++) yawDriftMonitor.observe(hit(6, o), profile);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
    // 반경 안 pose, chart는 샘플이 된다. 앵커 없는 패드는 제외
    yawDriftMonitor.observe(hit(6, { judgedBy: 'pose', inside: true }), profile);
    yawDriftMonitor.observe(hit(6, { judgedBy: 'chart' }), profile);
    yawDriftMonitor.observe(hit(6, { pad: 'CRASH' }), profile);
    expect(last[0]?.samples).toBe(2);
  });

  it('두 번째 보정은 applied − m (적용 −6에서 +9 측정 → −15 송신)', () => {
    const src = connected();
    feed(NINE_PLUS6);
    ack(-600, 0);
    vi.advanceTimersByTime(10_001);
    feed([9, 9.5, 8.5, 9, 9.2, 8.8, 9, 9.1, 8.9]); // 앵커 대비 +9 → applied −6 − 9 = −15
    expect(Math.abs(sentDeg(src.sent[1].bytes) - -15)).toBeLessThanOrEqual(0.5);
    expect(last[0]?.appliedDeg).toBeCloseTo(-15, 0);
  });

  it('resetPose 경로의 reset() → appliedDeg 0, 샘플 0', () => {
    connected();
    feed(NINE_PLUS6);
    ack(-600, 0);
    yawDriftMonitor.reset();
    expect(last[0]).toMatchObject({ appliedDeg: 0, samples: 0, lastSentAt: null });
  });

  it('WS형 소스(stickId 무시)에서 0x21 null stickId는 창이 열린 스틱에 반영된다', () => {
    connected();
    for (const e of NINE_PLUS6) yawDriftMonitor.observe(hit(e, { stickId: 1 }), profile);
    ack(-600, null);
    expect(last[1]).toMatchObject({ appliedDeg: -6, acked: true });
    expect(last[0]).toBeNull();
  });

  it('창 밖 0x21은 applied만 갱신하고 acked는 건드리지 않는다', () => {
    connected();
    feed(NINE_PLUS6);
    vi.advanceTimersByTime(600);
    expect(last[0]?.acked).toBe(false);
    ack(-250, 0);
    expect(last[0]).toMatchObject({ appliedDeg: -2.5, acked: false });
  });

  it('onConnected는 SET_YAW_OFFSET(0)을 보내고 applied 0·링 비움, 확인 창은 열지 않는다', () => {
    const src = connected();
    feed([6, 6, 6]);
    yawDriftMonitor.onConnected(0);
    expect(src.sent).toHaveLength(1);
    expect(Array.from(src.sent[0].bytes)).toEqual([0x16, 0x00, 0x00]);
    expect(src.sent[0].stickId).toBe(0);
    expect(last[0]).toMatchObject({ appliedDeg: 0, samples: 0, acked: null });
    vi.advanceTimersByTime(600);
    expect(last[0]?.acked).toBeNull();
  });

  it('미연결 소스·sendCommand 없는 소스·소스 없음은 무동작', () => {
    const src = new MockSource();
    yawDriftMonitor.setSource(src);
    feed(NINE_PLUS6);
    yawDriftMonitor.onConnected(0);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();

    const nc = new NoCmdSource();
    yawDriftMonitor.setSource(nc);
    nc.set('connected');
    feed(NINE_PLUS6);
    expect(last[0]).toBeNull();

    yawDriftMonitor.setSource(null);
    feed(NINE_PLUS6);
    expect(last[0]).toBeNull();
  });

  it('연결이 끊기면 상태 null', () => {
    const src = connected();
    feed([6, 6]);
    expect(last[0]?.samples).toBe(2);
    src.set('disconnected');
    expect(last[0]).toBeNull();
  });
});

describe('yawDriftMonitor 페달(stickId null, PLAY-002)', () => {
  // 인수 조건: 손 없는 타격은 방위각 보정 샘플에서 제외
  it('observe는 stickId null 타격을 무시한다(샘플·송신 없음)', () => {
    const src = connected();
    for (let k = 0; k < 12; k++) yawDriftMonitor.observe(hit(6, { stickId: null, foot: 3 }), profile);
    expect(src.sent).toHaveLength(0);
    expect(last).toEqual([null, null]);
  });
});

describe('yawDriftMonitor pause / resume / correct (PLAY-004)', () => {
  it('pause 중 observe는 샘플도 송신도 없고, resume 뒤에는 다시 쌓인다', () => {
    const src = connected();
    yawDriftMonitor.pause();
    expect(yawDriftMonitor.isPaused).toBe(true);
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
    yawDriftMonitor.resume();
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(1);
  });

  it('resume은 쌓여 있던 링을 비운다(옛 앵커 샘플이 섞이지 않게)', () => {
    connected();
    feed([6, 6, 6]);
    expect(last[0]?.samples).toBe(3);
    yawDriftMonitor.pause();
    yawDriftMonitor.resume();
    feed([6]);
    expect(last[0]?.samples).toBe(1);
  });

  it('correct(stickId, d)는 applied − d를 그 손에 보내고 확인 창을 연다. 쿨다운은 보지 않는다', () => {
    const src = connected();
    yawDriftMonitor.correct(1, 12);
    expect(src.sent).toHaveLength(1);
    expect(src.sent[0].stickId).toBe(1);
    expect(sentDeg(src.sent[0].bytes)).toBeCloseTo(-12);
    expect(last[1]).toMatchObject({ appliedDeg: -12, acked: null, samples: 0, lastErrorDeg: 12 });
    // 바로 다시 보정해도 쿨다운 없이 나간다: −12 − 3 = −15
    yawDriftMonitor.correct(1, 3);
    expect(src.sent).toHaveLength(2);
    expect(sentDeg(src.sent[1].bytes)).toBeCloseTo(-15);
    ack(-1500, 1);
    expect(last[1]).toMatchObject({ appliedDeg: -15, acked: true });
  });

  it('correct 뒤 500ms 안에 ACK가 없으면 acked false, 보낸 값은 유지', () => {
    connected();
    yawDriftMonitor.correct(0, -8);
    vi.advanceTimersByTime(600);
    expect(last[0]).toMatchObject({ appliedDeg: 8, acked: false });
  });

  it('보낼 수 없는 소스에서는 correct가 무동작', () => {
    const src = new NoCmdSource();
    yawDriftMonitor.setSource(src);
    src.set('connected');
    yawDriftMonitor.correct(0, 5);
    expect(last[0]).toBeNull();
  });
});
