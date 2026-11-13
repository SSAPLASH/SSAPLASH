// InputManager 통합 검증: 스틱 판정 우선·스틱 velocity·키보드·채보 후보 보정.
import { describe, expect, it } from 'vitest';
import { InputManager } from './InputManager';
import { BaseInputSource } from './source/InputSource';
import { computeBoundaries, createEmptyProfile, type CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { accelToVelocity, DEFAULT_SENSOR_TUNING } from '@/domain/kit/calibration/tuning';
import { KEY_MAP } from '@/domain/kit/keyMap';
import type { InputSourceKind, ResolvedHit, StickEvent, StickHitEvent } from '@/domain/events';
import { packetTap } from './packetTap';

/** emit을 공개한 모의 소스. connect는 바로 끝난다 */
class MockSource extends BaseInputSource {
  readonly label = 'mock';
  readonly kind: InputSourceKind;
  constructor(kind: InputSourceKind) {
    super();
    this.kind = kind;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  /** 테스트가 정하는 센서 시계 오프셋. null이면 미동기 */
  offset: number | null = null;
  clockOffsetOf(): number | null {
    return this.offset;
  }
  fire(e: StickEvent): void {
    this.emit(e);
  }
}

function hit(partial: Partial<StickHitEvent> = {}): StickHitEvent {
  return { kind: 'hit', stickId: 0, timestamp: 100, recvTime: 100, peakAccel: 4, pitch: 0, yaw: 0, ...partial };
}

function profile(): CalibrationProfile {
  const p = createEmptyProfile('pointer');
  p.anchors = computeBoundaries(
    {
      SNARE: { pad: 'SNARE', pitch: 0, yaw: -20, radius: 0, samples: 5, spread: 0 },
      HIHAT: { pad: 'HIHAT', pitch: 0, yaw: 20, radius: 0, samples: 5, spread: 0 },
      KICK: { pad: 'KICK', pitch: -30, yaw: 0, radius: 0, samples: 5, spread: 0 },
    },
    22,
  );
  return p;
}

async function setup(kind: InputSourceKind) {
  const im = new InputManager();
  im.setProfiles([profile(), profile()]);
  im.setKeyMap(KEY_MAP);
  const src = new MockSource(kind);
  await im.attach(src);
  const hits: ResolvedHit[] = [];
  im.onHit((h) => hits.push(h));
  return { im, src, hits };
}

describe('InputManager 판정', () => {
  it('스틱 hit: pad·velocity를 그대로 쓴다(stick)', async () => {
    const { src, hits } = await setup('ble');
    src.fire(hit({ pad: 'SNARE', velocity: 90, peakSpeedDps: 1500, pitch: 0, yaw: 20 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pad: 'SNARE', velocity: 90, judgedBy: 'stick', peakSpeedDps: 1500 });
  });

  it('스틱 hit seq를 ResolvedHit에 그대로 싣는다(판정에는 영향 없음)', async () => {
    const { src, hits } = await setup('ble');
    src.fire(hit({ pad: 'SNARE', velocity: 90, seq: 255 }));
    src.fire(hit({ pad: 'SNARE', velocity: 90 }));
    expect(hits[0]).toMatchObject({ seq: 255, pad: 'SNARE', judgedBy: 'stick' });
    expect(hits[1].seq).toBeUndefined();
    expect({ ...hits[0], id: 0, seq: undefined, tResolved: 0 }).toEqual({ ...hits[1], id: 0, tResolved: 0 });
  });

  it('스틱 velocity는 1~127로 clamp한다', async () => {
    const { src, hits } = await setup('ble');
    src.fire(hit({ pad: 'SNARE', velocity: 0 }));
    src.fire(hit({ pad: 'SNARE', velocity: 200 }));
    expect(hits.map((h) => h.velocity)).toEqual([1, 127]);
  });

  it('포인터형 hit(pad 없음): 가속도 곡선 + 자세 매퍼(pose)', async () => {
    const { src, hits } = await setup('pointer');
    src.fire(hit({ peakAccel: 4, pitch: 0, yaw: -20 }));
    expect(hits[0].pad).toBe('SNARE');
    expect(hits[0].judgedBy).toBe('pose');
    expect(hits[0].velocity).toBe(accelToVelocity(4, DEFAULT_SENSOR_TUNING.velocity));
    expect(hits[0].peakSpeedDps).toBeUndefined();
  });

  it('키보드 소스: 키 매퍼(key)', async () => {
    const { src, hits } = await setup('keyboard');
    src.fire(hit({ keyCode: 'KeyF' }));
    expect(hits[0]).toMatchObject({ pad: 'SNARE', judgedBy: 'key' });
  });

  it('센서 hit: firmwarePad·clockOffsetMs를 채우고 tSensorMs는 오프셋을 되뺀 센서 시각이다', async () => {
    const { src, hits } = await setup('ble');
    src.offset = 250;
    src.fire(hit({ pad: 'SNARE', velocity: 90, timestamp: 1000 }));
    src.fire(hit({ pad: null, velocity: 90, timestamp: 1000 }));
    expect(hits[0]).toMatchObject({ firmwarePad: 'SNARE', clockOffsetMs: 250, tSensorMs: 750 });
    expect(hits[1].firmwarePad).toBeNull();
  });

  it('센서 hit 미동기: clockOffsetMs null, tSensorMs 없음', async () => {
    const { src, hits } = await setup('ble');
    src.fire(hit({ pad: 'SNARE', velocity: 90 }));
    expect(hits[0].clockOffsetMs).toBeNull();
    expect(hits[0].tSensorMs).toBeUndefined();
  });

  it('키보드 hit: firmwarePad·tSensorMs·clockOffsetMs를 채우지 않는다', async () => {
    const { src, hits } = await setup('keyboard');
    src.offset = 250;
    src.fire(hit({ keyCode: 'KeyF', pad: 'SNARE' }));
    expect(hits[0].firmwarePad).toBeUndefined();
    expect(hits[0].tSensorMs).toBeUndefined();
    expect(hits[0].clockOffsetMs).toBeUndefined();
  });

  it('후보 [KICK], 스틱 pad SNARE, ambiguous → KICK·chart', async () => {
    const { im, src, hits } = await setup('ble');
    im.setCandidateProvider(() => ['KICK']);
    src.fire(hit({ pad: 'SNARE', velocity: 80, ambiguous: true }));
    expect(hits[0]).toMatchObject({ pad: 'KICK', judgedBy: 'chart', velocity: 80 });
  });
});

describe('InputManager 상태·활동 알림', () => {
  it('상태 리스너가 배터리를 받는다', async () => {
    const { im, src } = await setup('webserial');
    const got: Array<[number, boolean, number | undefined]> = [];
    im.onStatus((id, c, _s, b) => got.push([id, c, b]));
    src.fire({ kind: 'status', stickId: 1, connected: true, batteryPct: 64 });
    src.fire({ kind: 'status', stickId: 0, connected: true });
    expect(got).toEqual([
      [1, true, 64],
      [0, true, undefined],
    ]);
  });

  it('status 이벤트의 unconfigured를 리스너 다섯째 인자로 넘긴다', async () => {
    const { im, src } = await setup('webserial');
    const got: Array<boolean | undefined> = [];
    im.onStatus((_id, _c, _s, _b, u) => got.push(u));
    src.fire({ kind: 'status', stickId: 1, connected: true, batteryPct: 64, unconfigured: true });
    src.fire({ kind: 'status', stickId: 0, connected: true });
    expect(got).toEqual([true, undefined]);
  });

  it('attach(auto)는 autoConnect를 지원하면 connect 대신 그걸 부른다', async () => {
    const calls: string[] = [];
    class AutoSource extends MockSource {
      async connect(): Promise<void> {
        calls.push('connect');
      }
      async autoConnect(): Promise<void> {
        calls.push('auto');
      }
    }
    const im = new InputManager();
    await im.attach(new AutoSource('webserial'), true);
    await im.attach(new AutoSource('webserial'));
    expect(calls).toEqual(['auto', 'connect']);
  });
});

describe('InputManager 페달(foot)', () => {
  /** role별 시계 오프셋을 돌려주는 모의 소스 */
  class FootSource extends MockSource {
    offsets: Record<number, number | null> = { 0: 10, 1: 20, 2: 300, 3: 400 };
    clockOffsetOf(role?: number): number | null {
      return this.offsets[role ?? 0] ?? null;
    }
  }
  async function footSetup() {
    const im = new InputManager();
    im.setProfiles([profile(), profile()]);
    im.setKeyMap(KEY_MAP);
    im.setSensorOffsetMs(7);
    const src = new FootSource('webserial');
    await im.attach(src);
    const hits: ResolvedHit[] = [];
    im.onHit((h) => hits.push(h));
    return { im, src, hits };
  }

  // 인수 조건: role 3 HIT pad 7이 ResolvedHit{KICK, stickId null, foot 3, velocity 100, stick}으로 나온다
  it('foot 타격은 매퍼 없이 pad 그대로, stickId null·foot·velocity 100·tHit에 sensorOffsetMs를 더한다', async () => {
    const { src, hits } = await footSetup();
    // 프로파일상 KICK 위치가 아닌 자세(yaw 20 = HIHAT 쪽)여도 패킷 pad를 바꾸지 않는다
    src.fire(hit({ stickId: null, foot: 3, pad: 'KICK', velocity: 100, timestamp: 1000, pitch: 0, yaw: 20 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      pad: 'KICK',
      stickId: null,
      foot: 3,
      judgedBy: 'stick',
      velocity: 100,
      tHit: 1007,
      clockOffsetMs: 400,
      tSensorMs: 600,
    });
  });

  it('role 2 pad 8은 HIHAT_PEDAL, clockOffsetMs는 clockOffsetOf(2)', async () => {
    const { src, hits } = await footSetup();
    src.fire(hit({ stickId: null, foot: 2, pad: 'HIHAT_PEDAL', velocity: 100, timestamp: 500 }));
    expect(hits[0]).toMatchObject({ pad: 'HIHAT_PEDAL', foot: 2, stickId: null, clockOffsetMs: 300, tHit: 507 });
  });

  // 인수 조건: 시계를 모르면 tSensorMs 없음(손과 같은 규칙)
  it('foot 시계 오프셋이 null이면 tSensorMs는 없다', async () => {
    const { src, hits } = await footSetup();
    src.offsets[3] = null;
    src.fire(hit({ stickId: null, foot: 3, pad: 'KICK', velocity: 100 }));
    expect(hits[0].tSensorMs).toBeUndefined();
    expect(hits[0].clockOffsetMs).toBeNull();
  });

  // 인수 조건: onPedalStatus·onPedal 중계
  it('pedalStatus·pedal 이벤트를 리스너에 중계한다', async () => {
    const { im, src } = await footSetup();
    const statuses: unknown[] = [];
    const pedals: boolean[] = [];
    im.onPedalStatus((foot, connected, battery) => statuses.push([foot, connected, battery]));
    im.onPedal((closed) => pedals.push(closed));
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 80 });
    src.fire({ kind: 'pedal', foot: 2, closed: false, timestamp: 1, recvTime: 1 });
    src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 2, recvTime: 2 });
    expect(statuses).toEqual([[2, true, 80]]);
    expect(pedals).toEqual([false, true]);
  });

  // 인수 조건: 소스가 내려가면 두 발 끊김
  it('detach(소스 교체)에서 두 발 false를 알린다', async () => {
    const { im } = await footSetup();
    const statuses: unknown[] = [];
    im.onPedalStatus((foot, connected) => statuses.push([foot, connected]));
    const src = im.get('webserial') as FootSource;
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedalStatus', foot: 3, connected: true });
    statuses.length = 0;
    await im.attach(new FootSource('webserial')); // 같은 kind 교체 → detach
    expect(statuses).toEqual([
      [2, false],
      [3, false],
    ]);
  });
});

/** sendCommand를 기록하는 모의 센서 소스 */
class CommandSource extends MockSource {
  sent: Array<{ bytes: number[]; stickId: number | undefined }> = [];
  sendCommand(bytes: Uint8Array, stickId?: 0 | 1): void {
    this.sent.push({ bytes: [...bytes], stickId });
  }
}

describe('hapticWave·setLocalHaptic', () => {
  it('hapticWave는 sendCommand가 있는 소스에 HAPTIC 파형 바이트를 그 손으로 보낸다', async () => {
    const m = new InputManager();
    const sensor = new CommandSource('ble');
    await m.attach(sensor);
    m.hapticWave(1, 4);
    expect(sensor.sent).toEqual([{ bytes: [0x12, 4, 0], stickId: 1 }]);
  });

  it('setLocalHaptic은 SET_PARAM 0x05 값 1/0을 보내고 손을 안 주면 stickId가 없다', async () => {
    const m = new InputManager();
    const sensor = new CommandSource('ble');
    await m.attach(sensor);
    m.setLocalHaptic(false);
    m.setLocalHaptic(true, 0);
    expect(sensor.sent).toEqual([
      { bytes: [0x14, 0x05, 0, 0], stickId: undefined },
      { bytes: [0x14, 0x05, 1, 0], stickId: 0 },
    ]);
  });

  it('setMinPeak은 SET_PARAM 0x03 값을 그 손에만 보낸다(PLAY-004 ③)', async () => {
    const m = new InputManager();
    const sensor = new CommandSource('ble');
    await m.attach(sensor);
    m.setMinPeak(0, 320);
    m.setMinPeak(1, 400);
    expect(sensor.sent).toEqual([
      { bytes: [0x14, 0x03, 0x40, 0x01], stickId: 0 },
      { bytes: [0x14, 0x03, 0x90, 0x01], stickId: 1 },
    ]);
  });

  it('sendCommand가 없는 소스(키보드 등)는 무시하고 던지지 않는다', async () => {
    const m = new InputManager();
    await m.attach(new MockSource('keyboard'));
    expect(() => {
      m.hapticWave(0, 1);
      m.setLocalHaptic(false);
    }).not.toThrow();
  });
});


describe('하이햇 페달 스냅샷', () => {
  it('원시 타격 시각으로 상태를 찾고 오프셋과 소유자가 아닌 소스 detach에 영향받지 않는다', async () => {
    const { im, src, hits } = await setup('webserial');
    const keyboard = new MockSource('keyboard');
    await im.attach(keyboard);
    src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 10, recvTime: 10 });
    src.fire(hit({ pad: 'HIHAT', timestamp: 20 }));
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedal', foot: 2, closed: false, timestamp: 100, recvTime: 100 });
    src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 200, recvTime: 200 });
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 80 });
    im.setSensorOffsetMs(200);
    await im.detach('keyboard');
    src.fire(hit({ pad: 'HIHAT', timestamp: 150 }));
    src.fire(hit({ pad: 'HIHAT', timestamp: 250 }));
    expect(hits.map((h) => h.hihatClosed)).toEqual([null, false, true]);
    expect(hits[1].tHit).toBe(350);
  });
  it('소스 교체 뒤 이전 이벤트와 연결 전 페달을 무시한다', async () => {
    const { im, src, hits } = await setup('webserial');
    const other = new MockSource('ble');
    await im.attach(other);
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 10, recvTime: 10 });
    other.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 20, recvTime: 20 });
    other.fire(hit({ pad: 'HIHAT', timestamp: 30 }));
    other.fire({ kind: 'pedal', foot: 2, closed: false, timestamp: 25, recvTime: 25 });
    other.fire(hit({ pad: 'HIHAT', timestamp: 30 }));
    other.fire({ kind: 'pedalStatus', foot: 2, connected: false });
    other.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 31, recvTime: 31 });
    other.fire(hit({ pad: 'HIHAT', timestamp: 32 }));
    expect(hits.map((h) => h.hihatClosed)).toEqual([null, false, null]);
  });
});

it('비동기 detach가 끝나기 전에 페달 상태를 지운다', async () => {
  let finish!: () => void;
  class SlowSource extends MockSource {
    async disconnect(): Promise<void> { await new Promise<void>((resolve) => { finish = resolve; }); }
  }
  const im = new InputManager(); im.setKeyMap(KEY_MAP);
  const src = new SlowSource('webserial'); const keys = new MockSource('keyboard');
  await im.attach(src); await im.attach(keys);
  const hits: ResolvedHit[] = []; im.onHit((h) => hits.push(h));
  src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
  src.fire({ kind: 'pedal', foot: 2, closed: true, timestamp: 1, recvTime: 1 });
  const pending = im.detach('webserial');
  keys.fire(hit({ keyCode: 'KeyD', timestamp: 2 }));
  expect(im.getHihatPedalState()).toEqual({ connected: false, closed: null });
  expect(hits[0].hihatClosed).toBeNull();
  finish(); await pending;
});
describe('InputManager 손별 프로필·기준 자세 초기화(PLAY-004)', () => {
  it('왼손 타격은 왼손 프로필, 오른손 타격은 오른손 프로필로 판정한다', async () => {
    const im = new InputManager();
    const left = profile();
    const right = createEmptyProfile('ble');
    // 오른손 표는 스네어가 yaw +20 자리(왼손 표의 하이햇 자리)
    right.anchors = computeBoundaries({ SNARE: { pad: 'SNARE', pitch: 0, yaw: 20, radius: 0, samples: 2, spread: 0 } }, 22);
    im.setProfiles([left, right]);
    im.setKeyMap(KEY_MAP);
    const src = new MockSource('ble');
    await im.attach(src);
    const hits: ResolvedHit[] = [];
    im.onHit((h) => hits.push(h));
    src.fire(hit({ stickId: 0, pad: null, yaw: 20 }));
    src.fire(hit({ stickId: 1, pad: null, yaw: 20 }));
    expect(hits.map((h) => h.pad)).toEqual(['HIHAT', 'SNARE']);
    expect(im.profileFor(1)).toBe(right);
    im.dispose();
  });

  it('손별 매핑으로 정한 하이햇에만 페달 스냅샷을 적용한다', async () => {
    const im = new InputManager();
    const right = createEmptyProfile('ble');
    right.anchors = computeBoundaries({ SNARE: { pad: 'SNARE', pitch: 0, yaw: 20, radius: 0, samples: 2, spread: 0 } }, 22);
    im.setProfiles([profile(), right]);
    const src = new MockSource('ble');
    await im.attach(src);
    const hits: ResolvedHit[] = [];
    im.onHit((h) => hits.push(h));
    src.fire({ kind: 'pedalStatus', foot: 2, connected: true });
    src.fire({ kind: 'pedal', foot: 2, closed: false, timestamp: 50, recvTime: 50 });
    src.fire(hit({ stickId: 0, pad: null, yaw: 20, timestamp: 100 }));
    src.fire(hit({ stickId: 1, pad: null, yaw: 20, timestamp: 100 }));
    expect(hits.map((h) => [h.pad, h.hihatClosed])).toEqual([['HIHAT', false], ['SNARE', undefined]]);
    im.dispose();
  });

  it('resetPose()는 리스너에 (fe, null)로 알리고, 1초 안의 PARAM_ACK 0x22는 버튼으로 치지 않는다', async () => {
    const im = new InputManager();
    const calls: Array<[string, number | null]> = [];
    im.onResetPose((s, id) => calls.push([s, id]));
    const src = new MockSource('ble');
    await im.attach(src);
    im.resetPose();
    expect(calls).toEqual([['fe', null]]);
    packetTap.publish({ dir: 'in', transport: 'ble', stickId: 0, bytes: new Uint8Array([0x06, 0, 0x22, 0, 0]), recvTime: performance.now() });
    expect(calls).toHaveLength(1);
    im.dispose();
  });

  it('FE 요청 없이 온 PARAM_ACK 0x22는 (button, 그 손)으로 알린다. 레코드가 손을 모르면 패킷 role', async () => {
    const im = new InputManager();
    const calls: Array<[string, number | null]> = [];
    im.onResetPose((s, id) => calls.push([s, id]));
    const src = new MockSource('ble');
    await im.attach(src);
    packetTap.publish({ dir: 'in', transport: 'ble', stickId: 1, bytes: new Uint8Array([0x06, 0, 0x22, 0, 0]), recvTime: performance.now() });
    packetTap.publish({ dir: 'in', transport: 'serial', stickId: null, bytes: new Uint8Array([0x06, 0, 0x22, 0, 0]), recvTime: performance.now() });
    packetTap.publish({ dir: 'out', transport: 'serial', stickId: null, bytes: new Uint8Array([0x06, 1, 0x22, 0, 0]), recvTime: performance.now() });
    expect(calls).toEqual([
      ['button', 1],
      ['button', 0],
    ]);
    im.dispose();
  });
});
