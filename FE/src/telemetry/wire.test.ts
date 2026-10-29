import { describe, expect, it } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import { buildBatch, hitToEvent, statusToEvent, toIsoTime, type HitEventInput } from './wire';

const ORIGIN = Date.UTC(2026, 9, 27, 0, 0, 0);

function hit(p: Partial<ResolvedHit> = {}): ResolvedHit {
  return {
    id: 1,
    stickId: 0,
    pad: 'SMALL_TOM',
    velocity: 96,
    tHit: 1000,
    tRecv: 1000,
    tResolved: 1000.4,
    source: 'ble',
    pose: { pitch: 0, yaw: 0 },
    peakAccel: 3,
    judgedBy: 'stick',
    ...p,
  };
}

function input(h: ResolvedHit, extra: Partial<HitEventInput> = {}): HitEventInput {
  return { hit: h, judgement: 'PERFECT', deltaMs: 8.5, atMs: h.tRecv, timeOrigin: ORIGIN, ...extra };
}

describe('toIsoTime', () => {
  it('timeOrigin + 단조 시계 → ISO UTC', () => {
    expect(toIsoTime(1500, ORIGIN)).toBe('2026-10-27T00:00:01.500Z');
  });
  it('유한하지 않으면 null', () => {
    expect(toIsoTime(NaN, ORIGIN)).toBeNull();
    expect(toIsoTime(0, Infinity)).toBeNull();
  });
});

describe('hitToEvent', () => {
  it('센서 동기 타격: 필드를 채우고 패드 이름은 SMALL_TOM 그대로', () => {
    const ev = hitToEvent(
      input(hit({ firmwarePad: 'MID_TOM', tSensorMs: 750.1234, clockOffsetMs: 249.9, tAudio: 1001 }), { firmware: '1.0' }),
    )!;
    expect(ev).toMatchObject({
      kind: 'HIT',
      time: '2026-10-27T00:00:01.000Z',
      stickId: 0,
      pad: 'SMALL_TOM',
      predictedPad: 'SMALL_TOM',
      baselinePad: 'MID_TOM',
      judgement: 'PERFECT',
      deltaMs: 8.5,
      velocity: 96,
      tSensor: 750123,
      tRecv: 1000,
      tJudge: 1000.4,
      tAudio: 1001,
      clockOffsetMs: 249.9,
      packetLoss: null,
      batteryPct: null,
      tags: { source: 'ble', clockSynced: true, firmware: '1.0' },
    });
  });

  it('tags는 허용된 키만, firmware 없으면 키 자체가 없다', () => {
    const ev = hitToEvent(input(hit()))!;
    expect(Object.keys(ev.tags).sort()).toEqual(['clockSynced', 'source']);
  });

  it('키보드: stickId·baselinePad·tSensor·clockOffsetMs null, clockSynced false', () => {
    const ev = hitToEvent(input(hit({ source: 'keyboard', pad: 'SNARE', firmwarePad: 'HIHAT', tSensorMs: 5, clockOffsetMs: 3 })))!;
    expect(ev).toMatchObject({
      stickId: null,
      baselinePad: null,
      tSensor: null,
      clockOffsetMs: null,
      tags: { source: 'keyboard', clockSynced: false },
    });
  });

  it('KICK·HIHAT_PEDAL은 센서 소스여도 stickId null, 패드 없음(null)은 stickId 유지', () => {
    expect(hitToEvent(input(hit({ pad: 'KICK' })))!.stickId).toBeNull();
    expect(hitToEvent(input(hit({ pad: 'HIHAT_PEDAL' })))!.stickId).toBeNull();
    expect(hitToEvent(input(hit({ pad: null })))!).toMatchObject({ stickId: 0, pad: null, predictedPad: null });
  });

  it('센서 미동기: clockOffsetMs null이면 tSensor도 null, clockSynced false', () => {
    const ev = hitToEvent(input(hit({ clockOffsetMs: null, tSensorMs: 12 })))!;
    expect(ev).toMatchObject({ tSensor: null, clockOffsetMs: null, tags: { clockSynced: false } });
  });

  it('펌웨어 pad가 없음(undefined)·0xFF(null)면 baselinePad null', () => {
    expect(hitToEvent(input(hit({ firmwarePad: undefined })))!.baselinePad).toBeNull();
    expect(hitToEvent(input(hit({ firmwarePad: null })))!.baselinePad).toBeNull();
  });

  it('tAudio: 없거나 tJudge보다 작으면 null, 같으면 유지', () => {
    expect(hitToEvent(input(hit()))!.tAudio).toBeNull();
    expect(hitToEvent(input(hit({ tAudio: 1000.39 })))!.tAudio).toBeNull();
    expect(hitToEvent(input(hit({ tAudio: 1000.4 })))!.tAudio).toBe(1000.4);
    expect(hitToEvent(input(hit({ tAudio: NaN })))!.tAudio).toBeNull();
  });

  it('판정: PERFECT·GOOD만 deltaMs, MISS·null은 deltaMs null', () => {
    expect(hitToEvent(input(hit(), { judgement: 'GOOD', deltaMs: -30 }))).toMatchObject({ judgement: 'GOOD', deltaMs: -30 });
    expect(hitToEvent(input(hit(), { judgement: 'MISS', deltaMs: 200 }))).toMatchObject({ judgement: 'MISS', deltaMs: null });
    expect(hitToEvent(input(hit(), { judgement: null, deltaMs: 5 }))).toMatchObject({ judgement: null, deltaMs: null });
    expect(hitToEvent(input(hit(), { judgement: 'PERFECT', deltaMs: Infinity }))!.deltaMs).toBeNull();
  });

  it('velocity는 정수 0~127로 맞춘다', () => {
    expect(hitToEvent(input(hit({ velocity: 99.6 })))!.velocity).toBe(100);
    expect(hitToEvent(input(hit({ velocity: 300 })))!.velocity).toBe(127);
    expect(hitToEvent(input(hit({ velocity: -3 })))!.velocity).toBe(0);
  });

  it('tSensor가 음수면 null', () => {
    expect(hitToEvent(input(hit({ clockOffsetMs: 10, tSensorMs: -1 })))!.tSensor).toBeNull();
  });

  it('source는 32자로 자른다', () => {
    expect(hitToEvent(input(hit({ source: 'x'.repeat(40) })))!.tags.source).toHaveLength(32);
  });

  it('필수 시각이 유한하지 않으면 이벤트를 만들지 않는다', () => {
    expect(hitToEvent(input(hit({ tRecv: NaN })))).toBeNull();
    expect(hitToEvent(input(hit({ tResolved: Infinity })))).toBeNull();
    expect(hitToEvent(input(hit(), { atMs: NaN }))).toBeNull();
  });
});

describe('statusToEvent', () => {
  const base = { stickId: 1 as const, connected: true, source: 'ws', batteryPct: null, packetLoss: null, atMs: 2000, timeOrigin: ORIGIN };

  it('HIT 전용 필드는 모두 null, tags는 source·connected(+firmware)', () => {
    const ev = statusToEvent({ ...base, firmware: '1.0' })!;
    expect(ev).toMatchObject({
      kind: 'STATUS',
      stickId: 1,
      time: '2026-10-27T00:00:02.000Z',
      pad: null,
      baselinePad: null,
      predictedPad: null,
      judgement: null,
      deltaMs: null,
      velocity: null,
      tSensor: null,
      tRecv: null,
      tJudge: null,
      tAudio: null,
      clockOffsetMs: null,
      batteryPct: null,
      packetLoss: null,
      tags: { source: 'ws', connected: true, firmware: '1.0' },
    });
    expect(Object.keys(statusToEvent(base)!.tags).sort()).toEqual(['connected', 'source']);
  });

  it('packetLoss 0~1·batteryPct 0~100 정수로 맞추고 유한하지 않으면 null', () => {
    expect(statusToEvent({ ...base, packetLoss: 0.25, batteryPct: 87.4 })).toMatchObject({ packetLoss: 0.25, batteryPct: 87 });
    expect(statusToEvent({ ...base, packetLoss: 1.5, batteryPct: 250 })).toMatchObject({ packetLoss: 1, batteryPct: 100 });
    expect(statusToEvent({ ...base, packetLoss: NaN, batteryPct: NaN })).toMatchObject({ packetLoss: null, batteryPct: null });
  });
});

describe('buildBatch', () => {
  it('외피: schemaVersion 1, sessionId, mode, events', () => {
    const ev = statusToEvent({ stickId: 0, connected: true, source: 'ble', batteryPct: null, packetLoss: null, atMs: 0, timeOrigin: ORIGIN })!;
    expect(buildBatch('abc', null, [ev])).toEqual({ schemaVersion: 1, sessionId: 'abc', mode: null, events: [ev] });
  });
});
