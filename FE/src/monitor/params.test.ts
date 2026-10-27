import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARAM_ACK_END, STICK_PARAMS, decodePacket, type DecodedPacket } from '@/input/stickProtocol';
import { buildParamAck, buildStatus } from './mockStick';
import { ParamStore } from './params';

const status = (fwMajor: number): DecodedPacket =>
  decodePacket(buildStatus({ batteryPct: null, rssi: -60, fwMajor, fwMinor: 0 }), 0);
/** 복원 때 보낸 SET_PARAM을 id → 값으로 */
const sentValues = (bytes: Uint8Array[]): Record<number, number> =>
  Object.fromEntries(bytes.map((b) => [b[1], new DataView(b.buffer, b.byteOffset).getInt16(2, true)]));
const ack = (paramId: number, value: number): DecodedPacket => decodePacket(buildParamAck({ paramId, value }), 0);

let sent: Uint8Array[];
let store: ParamStore;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  store = new ParamStore((b) => sent.push(b));
});
afterEach(() => {
  store.reset();
  vi.useRealTimers();
});

describe('load', () => {
  it('14개 + 종료 표시 → loaded, lost 0', () => {
    expect(store.state).toBe('unknown');
    store.load();
    expect(store.state).toBe('loading');
    expect(sent[0][0]).toBe(0x17);
    for (const p of STICK_PARAMS) store.onPacket(ack(p.id, p.defaultValue));
    store.onPacket(ack(PARAM_ACK_END, 14));
    expect(store.state).toBe('loaded');
    expect(store.lostCount).toBe(0);
    expect(store.rows().every((r) => r.current !== null && r.note === null)).toBe(true);
  });

  it('13개 + 종료(value 14) → 유실 1, 못 받은 id는 lost', () => {
    store.load();
    for (const p of STICK_PARAMS.slice(0, 13)) store.onPacket(ack(p.id, p.defaultValue));
    store.onPacket(ack(PARAM_ACK_END, 14));
    expect(store.lostCount).toBe(1);
    const missing = store.rows()[13];
    expect(missing.current).toBeNull();
    expect(missing.note).toBe('lost');
    expect(store.rows()[0].note).toBeNull();
  });

  it('1초 안에 종료 표시가 없으면 보조 타임아웃으로 loaded', () => {
    store.load();
    store.onPacket(ack(0x01, 150));
    vi.advanceTimersByTime(999);
    expect(store.state).toBe('loading');
    vi.advanceTimersByTime(2);
    expect(store.state).toBe('loaded');
    expect(store.lostCount).toBeNull();
    expect(store.rows()[1].note).toBe('lost');
  });

  it('구독자는 변경마다 알림을 받고 version이 오른다', () => {
    let n = 0;
    store.subscribe(() => n++);
    const v = store.version;
    store.load();
    expect(n).toBeGreaterThan(0);
    expect(store.version).toBeGreaterThan(v);
  });
});

describe('apply', () => {
  it('같은 값이 돌아오면 note 없음, 다른 값이면 clipped', () => {
    store.apply(0x02, 20);
    expect(sent[0]).toEqual(new Uint8Array([0x14, 0x02, 20, 0]));
    let r = store.rows().find((x) => x.id === 0x02)!;
    expect(r.pending).toBe(true);
    expect(r.input).toBe(20);
    store.onPacket(ack(0x02, 20));
    r = store.rows().find((x) => x.id === 0x02)!;
    expect(r).toMatchObject({ pending: false, note: null, current: 20 });

    store.apply(0x02, 500);
    store.onPacket(ack(0x02, 100));
    r = store.rows().find((x) => x.id === 0x02)!;
    expect(r).toMatchObject({ pending: false, note: 'clipped', current: 100 });
  });

  it('500ms 무응답 → noAck', () => {
    store.apply(0x03, 300);
    vi.advanceTimersByTime(499);
    expect(store.rows().find((x) => x.id === 0x03)!.pending).toBe(true);
    vi.advanceTimersByTime(2);
    expect(store.rows().find((x) => x.id === 0x03)).toMatchObject({ pending: false, note: 'noAck' });
  });

  it('resetDefaults는 14개를 모두 보낸다', () => {
    store.resetDefaults();
    expect(sent.length).toBe(STICK_PARAMS.length);
  });

  it('기본값 복원: STATUS 전은 Feather 표', () => {
    expect(store.firmware()).toBe('feather');
    store.resetDefaults();
    expect(sentValues(sent)).toMatchObject({ 0x0a: 60, 0x0b: 160, 0x0e: 800, 0x0f: 1200, 0x01: 150, 0x02: 30 });
  });

  it('기본값 복원: fwMajor 0은 NUCLEO 표', () => {
    store.onPacket(status(0));
    expect(store.firmware()).toBe('nucleo');
    store.resetDefaults();
    expect(sentValues(sent)).toMatchObject({ 0x0a: 30, 0x0b: 400, 0x0e: 3000, 0x0f: 1000, 0x01: 150 });
  });

  it('기본값 복원: fwMajor 1은 Feather 표, 마지막 STATUS가 이긴다, reset하면 미확인', () => {
    store.onPacket(status(0));
    store.onPacket(status(1));
    expect(store.firmware()).toBe('feather');
    store.resetDefaults();
    expect(sentValues(sent)).toMatchObject({ 0x0a: 60, 0x0b: 160, 0x0e: 800, 0x0f: 1200 });
    store.reset();
    expect(store.fwMajor).toBeNull();
  });

  it('STATUS가 같은 fwMajor면 알림을 내지 않는다', () => {
    store.onPacket(status(1));
    const v = store.version;
    store.onPacket(status(1));
    expect(store.version).toBe(v);
  });
});

describe('적용 확인', () => {
  it('padTable은 3패킷이면 마지막 값(7)', () => {
    store.expectConfirmation('padTable');
    store.onPacket(ack(0x20, 3));
    store.onPacket(ack(0x20, 6));
    store.onPacket(ack(0x20, 7));
    vi.advanceTimersByTime(600);
    expect(store.confirmations()[0]).toMatchObject({ kind: 'padTable', value: 7 });
  });

  it('창 안에 안 오면 value null(확인 없음), 창이 닫힌 뒤 오는 값은 무시', () => {
    store.expectConfirmation('yawOffset');
    expect(store.confirmations()[0]).toMatchObject({ kind: 'yawOffset', value: null, open: true });
    vi.advanceTimersByTime(600);
    store.onPacket(ack(0x21, 100));
    expect(store.confirmations()[0]).toMatchObject({ kind: 'yawOffset', value: null, open: false });
  });

  it('최신 먼저, 최대 20개', () => {
    for (let i = 0; i < 25; i++) store.expectConfirmation(i % 2 ? 'yawOffset' : 'resetPose');
    const c = store.confirmations();
    expect(c.length).toBe(20);
    store.onPacket(ack(0x22, -500));
    expect(store.confirmations()[0]).toMatchObject({ kind: 'resetPose', value: -500 });
  });
});

describe('요청 없는 0x22(스틱 버튼 보정)', () => {
  it('열린 창이 없으면 버튼 항목 1건', () => {
    store.onPacket(ack(0x22, 1234));
    expect(store.confirmations()).toHaveLength(1);
    expect(store.confirmations()[0]).toMatchObject({ kind: 'resetPose', value: 1234, open: false, source: 'button' });
  });

  it('창이 있으면 기존 동작(명령 응답), 버튼 항목은 늘지 않는다', () => {
    store.expectConfirmation('resetPose');
    store.onPacket(ack(0x22, -500));
    expect(store.confirmations()).toHaveLength(1);
    expect(store.confirmations()[0]).toMatchObject({ value: -500, source: 'command' });
  });

  it('창이 닫힌 뒤의 0x22는 버튼 항목으로 쌓이고, 0x20·0x21은 계속 버린다', () => {
    store.expectConfirmation('resetPose');
    vi.advanceTimersByTime(600);
    store.onPacket(ack(0x22, 7));
    store.onPacket(ack(0x21, 7));
    store.onPacket(ack(0x20, 7));
    const c = store.confirmations();
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ source: 'button', value: 7 });
    expect(c[1]).toMatchObject({ source: 'command', value: null, open: false });
  });
});

describe('reset', () => {
  it('unknown으로 돌아가고 타이머를 정리한다', () => {
    store.load();
    store.apply(0x01, 1);
    store.reset();
    expect(store.state).toBe('unknown');
    expect(vi.getTimerCount()).toBe(0);
    expect(store.rows().every((r) => r.current === null && !r.pending)).toBe(true);
  });
});
