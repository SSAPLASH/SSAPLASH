// InputManager 통합 검증: 스틱 판정 우선·스틱 velocity·키보드·채보 후보 보정.
import { describe, expect, it } from 'vitest';
import { InputManager } from './InputManager';
import { BaseInputSource } from './InputSource';
import { computeBoundaries, createEmptyProfile, type CalibrationProfile } from '@/domain/calibration';
import { accelToVelocity, DEFAULT_SENSOR_TUNING } from '@/domain/tuning';
import { KEY_MAP } from '@/domain/keyMap';
import type { InputSourceKind, ResolvedHit, StickEvent, StickHitEvent } from '@/domain/events';

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
  im.setProfile(profile());
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
