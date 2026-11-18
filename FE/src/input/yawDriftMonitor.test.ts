import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationProfile, PadAnchor, YawDriftStatus } from '@/domain/kit/calibration/calibration';
import type { InputSourceKind, ResolvedHit, SourceState, StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { BaseInputSource } from './source/InputSource';
import { packetTap } from './packetTap';
import { yawDriftMonitor, type YawCorrection, type YawHalt } from './yawDriftMonitor';

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
    inside: true,
    ...over,
  }) as ResolvedHit;

const feed = (errs: number[]) => {
  for (const e of errs) yawDriftMonitor.observe(hit(e), profile);
};

const PARAM_ACK_YAW_OFFSET = 0x21;
/** 0x21 응답. stickId는 레코드의 손(BLE·WS 링크), role은 패킷 flags 비트 0–1(0 왼손·1 오른손·2·3 페달) */
const ack = (value: number, stickId: 0 | 1 | null = null, role = 0) =>
  packetTap.publish({
    dir: 'in',
    transport: 'ble',
    stickId,
    bytes: new Uint8Array([0x06, role, PARAM_ACK_YAW_OFFSET, value & 0xff, (value >> 8) & 0xff]),
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

  it('키보드·preview·pad null·chart·key·pose·패드 밖(inside false·없음) 타격은 샘플에 들어가지 않는다', () => {
    const src = connected();
    const bad: Partial<ResolvedHit>[] = [
      { source: 'keyboard' as InputSourceKind },
      { source: 'preview' as InputSourceKind },
      { pad: null },
      { judgedBy: 'pose', inside: false },
      { judgedBy: 'pose' },
      { judgedBy: 'key' },
      { judgedBy: 'chart' },
      { judgedBy: 'chart', inside: false },
      { judgedBy: 'stick', inside: false },
      { judgedBy: 'stick', inside: undefined },
      { judgedBy: 'pose', inside: true },
    ];
    for (const o of bad) for (let k = 0; k < 9; k++) yawDriftMonitor.observe(hit(6, o), profile);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
    // 스틱이 직접 판정했고 패드 안인 타격만 샘플이 된다. 앵커 없는 패드는 제외
    yawDriftMonitor.observe(hit(6), profile);
    yawDriftMonitor.observe(hit(6, { pad: 'CRASH' }), profile);
    expect(last[0]?.samples).toBe(1);
  });

  it('두 번째 보정은 applied − m (적용 −6에서 +7 측정 → −13 송신)', () => {
    const src = connected();
    feed(NINE_PLUS6);
    ack(-600, 0);
    vi.advanceTimersByTime(10_001);
    feed([7, 7.5, 6.5, 7, 7.2, 6.8, 7, 7.1, 6.9]); // 앵커 대비 +7 → applied −6 − 7 = −13
    expect(Math.abs(sentDeg(src.sent[1].bytes) - -13)).toBeLessThanOrEqual(0.5);
    expect(last[0]?.appliedDeg).toBeCloseTo(-13, 0);
  });

  it('resetPose 경로의 reset() → appliedDeg 0, 샘플 0', () => {
    connected();
    feed(NINE_PLUS6);
    ack(-600, 0);
    yawDriftMonitor.reset();
    expect(last[0]).toMatchObject({ appliedDeg: 0, samples: 0, lastSentAt: null });
  });

  it('손을 알 수 없는 0x21(레코드 손 없음 + 손이 아닌 role)은 창이 열린 스틱에 반영된다', () => {
    connected();
    for (const e of NINE_PLUS6) yawDriftMonitor.observe(hit(e, { stickId: 1 }), profile);
    ack(-600, null, 2);
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

describe('yawDriftMonitor PARAM_ACK 손 구분 (PLAY-004)', () => {
  it('손 정보 없는 레코드(Web Serial)의 0x21은 패킷 role의 손에만 반영된다', () => {
    connected();
    yawDriftMonitor.correct(0, 58);
    ack(-5800, null, 0);
    expect(last[0]).toMatchObject({ appliedDeg: -58, acked: true });
    yawDriftMonitor.correct(1, 10);
    ack(-1000, null, 1);
    expect(last[1]).toMatchObject({ appliedDeg: -10, acked: true });
    expect(last[0]).toMatchObject({ appliedDeg: -58, acked: true });
  });

  it('양손 확인 창이 함께 열려 있어도 각 응답은 자기 손에만 반영된다(양손 재정렬)', () => {
    connected();
    yawDriftMonitor.correct(0, 58);
    yawDriftMonitor.correct(1, 45);
    ack(-5800, null, 0);
    expect(last[1]).toMatchObject({ appliedDeg: -45, acked: null });
    ack(-4500, null, 1);
    expect(last[0]).toMatchObject({ appliedDeg: -58, acked: true });
    expect(last[1]).toMatchObject({ appliedDeg: -45, acked: true });
  });

  it('한 손에 보낸 0의 응답이 창 없이 와도 다른 손 적용값은 남고, 그 손의 다음 보정은 남은 적용값 기준이다', () => {
    const src = connected();
    yawDriftMonitor.correct(0, 58);
    ack(-5800, null, 0);
    vi.advanceTimersByTime(600);
    // 오른손이 새로 붙어 0으로 맞춘다(확인 창 없음)
    yawDriftMonitor.onConnected(1);
    ack(0, null, 1);
    expect(last[0]).toMatchObject({ appliedDeg: -58 });
    expect(last[1]).toMatchObject({ appliedDeg: 0 });
    // 쿨다운 뒤 왼손 드리프트 보정: −58 − 6 = −64 (0 − 6이 아니다)
    vi.advanceTimersByTime(10_000);
    feed(NINE_PLUS6);
    const sent = src.sent[src.sent.length - 1];
    expect(sent.stickId).toBe(0);
    expect(sentDeg(sent.bytes)).toBeCloseTo(-64);
  });

  it('레코드에 손이 있으면(BLE·WS 링크) 패킷 role보다 먼저다', () => {
    connected();
    yawDriftMonitor.correct(1, 12);
    ack(-1200, 1, 0);
    expect(last[1]).toMatchObject({ appliedDeg: -12, acked: true });
    expect(last[0]).toBeNull();
  });

  it('손을 알 수 없고 열린 확인 창도 없으면 어느 손에도 반영하지 않는다', () => {
    connected();
    yawDriftMonitor.correct(0, 58);
    yawDriftMonitor.correct(1, 45);
    vi.advanceTimersByTime(600);
    ack(-900, null, 3);
    expect(last[0]).toMatchObject({ appliedDeg: -58, acked: false });
    expect(last[1]).toMatchObject({ appliedDeg: -45, acked: false });
  });
});

describe('yawDriftMonitor 소스 상태 변화와 적용값 기억 (PLAY-004)', () => {
  it('포트를 다시 열어도(연결 중 → 연결됨) 적용값은 남고 링·쿨다운은 비워진다', () => {
    const src = connected();
    yawDriftMonitor.correct(0, 58);
    ack(-5800, null, 0);
    feed([6, 6]);
    src.set('connecting');
    expect(last[0]).toBeNull();
    src.set('connected');
    // 쿨다운이 비워져 바로 보정이 나가고, 기준은 남아 있던 −58이다: −58 − 6 = −64
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(2);
    expect(sentDeg(src.sent[1].bytes)).toBeCloseTo(-64);
    // 끊기기 전 샘플 2개가 남았다면 6번째에 보내 3개가 남는다. 비워졌으므로 8번째에 보내고 9번째 1개만 남는다
    expect(last[0]).toMatchObject({ appliedDeg: -64, samples: 1 });
  });

  it('끊긴 동안 열려 있던 확인 창은 닫힌다(다시 붙은 뒤 acked false로 바뀌지 않는다)', () => {
    const src = connected();
    yawDriftMonitor.correct(0, 58);
    src.set('disconnected');
    src.set('connected');
    vi.advanceTimersByTime(600);
    expect(last[0]).toBeNull();
    yawDriftMonitor.correct(0, 2);
    expect(last[0]).toMatchObject({ appliedDeg: -60, acked: null });
  });

  it('다시 붙은 스틱이 꺼졌다 켜진 것이면(onConnected) 0으로 맞추고 기억도 0이다', () => {
    const src = connected();
    yawDriftMonitor.correct(0, 58);
    src.set('connecting');
    src.set('connected');
    yawDriftMonitor.onConnected(0);
    expect(last[0]).toMatchObject({ appliedDeg: 0 });
    yawDriftMonitor.correct(0, 5);
    expect(sentDeg(src.sent[src.sent.length - 1].bytes)).toBeCloseTo(-5);
  });

  it('소스를 바꾸면 적용값을 잊는다', () => {
    connected();
    yawDriftMonitor.correct(0, 58);
    const next = connected();
    yawDriftMonitor.correct(0, 5);
    expect(sentDeg(next.sent[0].bytes)).toBeCloseTo(-5);
  });
});

describe('yawDriftMonitor onLinked: 현재 오프셋 읽기 (PLAY-004)', () => {
  it('GET_PARAMS([0x17])를 그 손에만 보내고 상태를 보고한다. SET_YAW_OFFSET은 보내지 않는다', () => {
    const src = connected();
    yawDriftMonitor.onLinked(1);
    expect(src.sent).toHaveLength(1);
    expect(Array.from(src.sent[0].bytes)).toEqual([0x17]);
    expect(src.sent[0].stickId).toBe(1);
    expect(last[1]).toMatchObject({ appliedDeg: 0, samples: 0, lastSentAt: null, acked: null });
    expect(last[0]).toBeNull();
  });

  it('창 없이 온 0x21(스틱 FW 1.12의 GET_PARAMS 응답)이 그 손 적용값이 되고, 다음 재정렬은 그 값 기준이다', () => {
    const src = connected();
    yawDriftMonitor.onLinked(1);
    ack(-7760, null, 1);
    expect(last[1]).toMatchObject({ appliedDeg: -77.6, acked: null, lastSentAt: null });
    expect(last[0]).toBeNull();
    yawDriftMonitor.correct(1, 5);
    expect(sentDeg(src.sent[src.sent.length - 1].bytes)).toBeCloseTo(-82.6);
  });

  it('읽어 온 응답은 쿨다운을 시작하지 않는다(바로 드리프트 보정이 나갈 수 있다)', () => {
    const src = connected();
    yawDriftMonitor.onLinked(0);
    ack(-5800, null, 0);
    feed(NINE_PLUS6);
    const sent = src.sent[src.sent.length - 1];
    expect(sentDeg(sent.bytes)).toBeCloseTo(-64);
  });

  it('0x21이 오지 않으면(FW 1.11 이하) 적용값은 그대로 0이다', () => {
    const src = connected();
    yawDriftMonitor.onLinked(0);
    vi.advanceTimersByTime(2000);
    expect(last[0]).toMatchObject({ appliedDeg: 0, acked: null });
    yawDriftMonitor.correct(0, 5);
    expect(sentDeg(src.sent[src.sent.length - 1].bytes)).toBeCloseTo(-5);
  });

  it('onLinked를 부르지 않은 손(상태 없음)은 창 없이 온 0x21을 건너뛴다', () => {
    connected();
    ack(-7760, null, 1);
    expect(last[1]).toBeNull();
  });

  it('포트를 다시 연 뒤에는 남아 있던 적용값을 보고하고, 응답이 오면 스틱 값으로 맞춘다', () => {
    const src = connected();
    yawDriftMonitor.correct(0, 58);
    ack(-5800, null, 0);
    src.set('connecting');
    src.set('connected');
    yawDriftMonitor.onLinked(0);
    expect(last[0]).toMatchObject({ appliedDeg: -58 });
    ack(-6000, null, 0);
    expect(last[0]).toMatchObject({ appliedDeg: -60 });
  });

  it('보낼 수 없는 소스에서는 무동작', () => {
    const src = new NoCmdSource();
    yawDriftMonitor.setSource(src);
    src.set('connected');
    yawDriftMonitor.onLinked(0);
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

describe('yawDriftMonitor onCorrection (PLAY-002 실연주 진단)', () => {
  const listen = () => {
    const got: YawCorrection[] = [];
    yawDriftMonitor.onCorrection((c) => got.push(c));
    return got;
  };

  it('드리프트 보정: 보낼 때 1회, 그때 링 샘플·중앙값·MAD와 sentDeg = prevDeg − medianDeg', () => {
    const got = listen();
    const src = connected();
    feed(NINE_PLUS6);
    expect(src.sent).toHaveLength(1);
    expect(got).toHaveLength(1);
    const c = got[0];
    expect(c).toMatchObject({ stickId: 0, reason: 'drift', prevDeg: 0 });
    // 8번째 샘플에서 보냈다
    expect(c.samples).toHaveLength(8);
    c.samples.forEach((v, k) => expect(v).toBeCloseTo(NINE_PLUS6[k]));
    expect(c.medianDeg).toBeCloseTo(6);
    expect(c.madDeg).not.toBeNull();
    expect(c.madDeg!).toBeLessThan(1);
    expect(c.sentDeg).toBeCloseTo(c.prevDeg - c.medianDeg!);
    expect(c.sentDeg).toBeCloseTo(sentDeg(src.sent[0].bytes), 1);
  });

  it('보내지 않으면(샘플 부족·쿨다운) 부르지 않는다', () => {
    const got = listen();
    connected();
    feed([6, 6, 6]);
    expect(got).toHaveLength(0);
    feed(NINE_PLUS6);
    vi.advanceTimersByTime(5000);
    feed(NINE_PLUS6);
    expect(got).toHaveLength(1);
  });

  it('재정렬(correct): realign, medianDeg는 요청 오차, 샘플은 빈 배열. 두 번째는 prevDeg가 앞선 적용값', () => {
    const got = listen();
    connected();
    yawDriftMonitor.correct(1, 12);
    yawDriftMonitor.correct(1, 3);
    expect(got).toEqual([
      { stickId: 1, reason: 'realign', prevDeg: 0, sentDeg: -12, medianDeg: 12, madDeg: null, samples: [], judgedBy: [] },
      { stickId: 1, reason: 'realign', prevDeg: -12, sentDeg: -15, medianDeg: 3, madDeg: null, samples: [], judgedBy: [] },
    ]);
  });

  it('연결 직후 0 초기화(onConnected): connected, 보내기 전 적용값을 싣는다', () => {
    const got = listen();
    connected();
    yawDriftMonitor.correct(0, 5);
    got.length = 0;
    yawDriftMonitor.onConnected(0);
    expect(got).toEqual([{ stickId: 0, reason: 'connected', prevDeg: -5, sentDeg: 0, medianDeg: null, madDeg: null, samples: [], judgedBy: [] }]);
  });

  it('보낼 수 없는 소스에서는 부르지 않고, resetAll이 콜백을 지운다', () => {
    const got = listen();
    yawDriftMonitor.correct(0, 5);
    yawDriftMonitor.onConnected(0);
    expect(got).toHaveLength(0);
    yawDriftMonitor.resetAll();
    connected();
    yawDriftMonitor.correct(0, 5);
    expect(got).toHaveLength(0);
  });
});

describe('yawDriftMonitor 표본 좁히기·보정량 상한·흔들림 정지 (PLAY-004 yaw drift guard)', () => {
  /** 오차 e가 일정한 표본 8개(후보 조건을 채운다)를 그 손에 넣고, 다음 후보가 쿨다운에 걸리지 않게 시간을 보낸다 */
  const round = (e: number, stickId: StickId = 0) => {
    for (let k = 0; k < 8; k++) yawDriftMonitor.observe(hit(e, { stickId }), profile);
    vi.advanceTimersByTime(10_001);
  };
  const halts = () => {
    const got: YawHalt[] = [];
    yawDriftMonitor.onHalt((h) => got.push(h));
    return got;
  };

  it('judgedBy chart 타격과 inside false 타격은 8개를 넣어도 표본이 되지 않아 보내지 않는다', () => {
    const src = connected();
    for (let k = 0; k < 8; k++) yawDriftMonitor.observe(hit(10, { judgedBy: 'chart', inside: true }), profile);
    for (let k = 0; k < 8; k++) yawDriftMonitor.observe(hit(10, { judgedBy: 'stick', inside: false }), profile);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
  });

  it('pose 판정은 inside가 true여도 표본이 되지 않는다', () => {
    const src = connected();
    for (let k = 0; k < 8; k++) yawDriftMonitor.observe(hit(10, { judgedBy: 'pose', inside: true }), profile);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
  });

  it('오차 15°가 모여도 한 번에 8°만 움직인다(적용값 0 → −8). medianDeg는 자르기 전 15', () => {
    const got: YawCorrection[] = [];
    yawDriftMonitor.onCorrection((c) => got.push(c));
    const src = connected();
    round(15);
    expect(src.sent).toHaveLength(1);
    expect(sentDeg(src.sent[0].bytes)).toBe(-8);
    expect(got[0]).toMatchObject({ reason: 'drift', prevDeg: 0, sentDeg: -8, medianDeg: 15 });
    expect(last[0]?.appliedDeg).toBe(-8);
  });

  it('음수 오차도 +8°로 자른다', () => {
    const src = connected();
    round(-20);
    expect(sentDeg(src.sent[0].bytes)).toBe(8);
  });

  it('+, −, + 순서의 후보: 세 번째는 보내지 않고 halted가 true, onHalt가 한 번 불린다', () => {
    const h = halts();
    const src = connected();
    round(7);
    round(-7);
    expect(src.sent).toHaveLength(2);
    expect(h).toHaveLength(0);
    expect(last[0]?.halted).toBe(false);
    round(7);
    expect(src.sent).toHaveLength(2);
    expect(last[0]?.halted).toBe(true);
    expect(last[0]?.samples).toBe(0);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ stickId: 0, flips: 2, medianDeg: 7 });
    expect(h[0].appliedDeg).toBeCloseTo(last[0]!.appliedDeg);
  });

  it('+, −, −, + 는 멈추지 않는다(같은 부호가 나오면 뒤집힘 횟수가 0으로 돌아간다)', () => {
    const h = halts();
    const src = connected();
    round(7);
    round(-7);
    round(-7);
    round(7);
    expect(src.sent).toHaveLength(4);
    expect(h).toHaveLength(0);
    expect(last[0]?.halted).toBe(false);
  });

  it('멈춘 손의 타격은 링에 쌓이지 않고, 다른 손은 계속 보정된다', () => {
    const src = connected();
    round(7);
    round(-7);
    round(7); // 왼손 멈춤
    expect(last[0]?.halted).toBe(true);
    for (let k = 0; k < 5; k++) yawDriftMonitor.observe(hit(7), profile);
    expect(last[0]?.samples).toBe(0);
    const before = src.sent.length;
    round(9, 1);
    expect(src.sent.length).toBe(before + 1);
    expect(src.sent[before].stickId).toBe(1);
    expect(last[1]?.halted).toBe(false);
    expect(last[0]?.halted).toBe(true);
  });

  it('beginRun() 뒤 다시 보정된다. 링·적용값은 그대로다', () => {
    const src = connected();
    round(7);
    round(-7);
    round(7);
    const applied = last[0]!.appliedDeg;
    yawDriftMonitor.beginRun();
    expect(last[0]?.halted).toBe(false);
    expect(last[0]?.appliedDeg).toBe(applied);
    const before = src.sent.length;
    round(7);
    expect(src.sent.length).toBe(before + 1);
  });

  it('beginRun() 뒤 부호 추적도 비워져, 직전 부호와 반대여도 뒤집힘으로 세지 않는다', () => {
    const h = halts();
    connected();
    round(7);
    round(-7);
    round(7); // 멈춤
    yawDriftMonitor.beginRun();
    round(-7);
    round(7);
    expect(h).toHaveLength(1);
    expect(last[0]?.halted).toBe(false);
  });

  it('재정렬(correct) 뒤에도 풀린다', () => {
    const src = connected();
    round(7);
    round(-7);
    round(7);
    expect(last[0]?.halted).toBe(true);
    yawDriftMonitor.correct(0, 3);
    expect(last[0]?.halted).toBe(false);
    vi.advanceTimersByTime(10_001); // 재정렬도 쿨다운을 시작한다
    const before = src.sent.length;
    round(7);
    expect(src.sent.length).toBe(before + 1);
  });

  it('drift의 judgedBy는 samples와 길이가 같고 모두 stick이다. 재정렬·연결 직후는 빈 배열', () => {
    const got: YawCorrection[] = [];
    yawDriftMonitor.onCorrection((c) => got.push(c));
    connected();
    round(7);
    expect(got[0].judgedBy).toHaveLength(got[0].samples.length);
    expect(got[0].samples.length).toBeGreaterThan(0);
    expect(got[0].judgedBy.every((j) => j === 'stick')).toBe(true);
    yawDriftMonitor.correct(0, 2);
    yawDriftMonitor.onConnected(0);
    expect(got[1].judgedBy).toEqual([]);
    expect(got[2].judgedBy).toEqual([]);
  });

  it('소스를 바꾸면(forget) 멈춤도 비워지고, resetAll이 정지 콜백을 지운다', () => {
    const h = halts();
    connected();
    round(7);
    round(-7);
    round(7);
    expect(h).toHaveLength(1);
    yawDriftMonitor.setSource(null);
    connected();
    expect(last[0]).toBeNull();
    round(-7);
    round(7); // 부호 추적이 비워져 뒤집힘으로 세지 않는다
    expect(h).toHaveLength(1);
    expect(last[0]?.halted).toBe(false);
    yawDriftMonitor.resetAll();
    expect(h).toHaveLength(1);
  });
});
