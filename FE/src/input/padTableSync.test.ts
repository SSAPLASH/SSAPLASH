import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationProfile, PadAnchor, PadTableStatus } from '@/domain/calibration';
import type { InputSourceKind, SourceState } from '@/domain/events';
import { STICK_PADS, type PadId } from '@/domain/pads';
import { BaseInputSource } from './InputSource';
import { packetTap } from './packetTap';
import { padTableSync } from './padTableSync';

class MockSource extends BaseInputSource {
  readonly kind = 'ws' as InputSourceKind;
  readonly label = 'mock';
  sent: Uint8Array[] = [];
  sendCommand(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

/** sendCommand가 없는 소스(키보드·포인터와 같은 조건) */
class NoCmdSource extends BaseInputSource {
  readonly kind = 'pointer' as InputSourceKind;
  readonly label = 'nocmd';
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

const anchor = (pad: PadId, pitch: number, yaw: number): PadAnchor => ({ pad, pitch, yaw, radius: 10, samples: 0, spread: 0 });
const profile = (pads: PadId[], shift = 0): CalibrationProfile =>
  ({ anchors: Object.fromEntries(pads.map((p, i) => [p, anchor(p, 10 + i + shift, -20 + i * 5)])) }) as unknown as CalibrationProfile;

const PARAM_ACK_PAD_TABLE = 0x20;
const ack = (value: number, paramId = PARAM_ACK_PAD_TABLE) =>
  packetTap.publish({
    dir: 'in',
    transport: 'ws',
    stickId: null,
    bytes: new Uint8Array([0x06, 0, paramId, value & 0xff, value >> 8]),
    recvTime: 0,
  });

let last: PadTableStatus | null;

beforeEach(() => {
  vi.useFakeTimers();
  padTableSync.reset();
  last = null;
  padTableSync.onStatus((st) => {
    last = st;
  });
});
afterEach(() => {
  padTableSync.reset();
  vi.useRealTimers();
});

const connected = () => {
  const src = new MockSource();
  padTableSync.setSource(src);
  src.set('connected');
  return src;
};

describe('padTableSync', () => {
  it('7앵커 → 3패킷, 첫 패킷은 지우고 시작·3개, 첫 항목은 CRASH(pad 0)', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS));
    expect(STICK_PADS).toHaveLength(7);
    expect(src.sent).toHaveLength(3);
    expect(src.sent[0][0]).toBe(0x15);
    expect(src.sent[0][1]).toBe(0x83);
    expect(src.sent[1][1]).toBe(0x03);
    expect(src.sent[2][1]).toBe(0x01);
    expect(src.sent[0][2]).toBe(0);
    expect(last).toMatchObject({ sent: 7, acked: null });
  });

  it('같은 프로필은 다시 보내지 않고, 반올림 안의 변화는 무시·0.1° 변화는 재송신', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS));
    padTableSync.push(profile(STICK_PADS));
    expect(src.sent).toHaveLength(3);
    padTableSync.push(profile(STICK_PADS, 0.001));
    expect(src.sent).toHaveLength(3);
    padTableSync.push(profile(STICK_PADS, 0.1));
    expect(src.sent).toHaveLength(6);
  });

  it('미연결이면 보내지 않고 상태는 null', () => {
    const src = new MockSource();
    padTableSync.setSource(src);
    padTableSync.push(profile(STICK_PADS));
    expect(src.sent).toHaveLength(0);
    expect(last).toBeNull();
  });

  it('sendCommand가 없는 소스(키보드·포인터)는 무동작, 상태 null', () => {
    const src = new NoCmdSource();
    padTableSync.setSource(src);
    src.set('connected');
    padTableSync.push(profile(STICK_PADS));
    expect(last).toBeNull();
  });

  it('소스가 없으면 무동작', () => {
    padTableSync.push(profile(STICK_PADS));
    expect(last).toBeNull();
  });

  it('페달 앵커는 걸러진다', () => {
    const src = connected();
    padTableSync.push(profile([...STICK_PADS.slice(0, 2), 'KICK', 'HIHAT_PEDAL']));
    expect(src.sent).toHaveLength(1);
    expect(src.sent[0][1]).toBe(0x82);
    expect(last?.sent).toBe(2);
  });

  it('PARAM_ACK 0x20 값을 받아 마지막 값이 남고, 다른 paramId는 무시한다', () => {
    connected();
    padTableSync.push(profile(STICK_PADS));
    ack(3);
    ack(6);
    ack(7);
    expect(last).toMatchObject({ sent: 7, acked: 7 });
    ack(5, 0x01);
    expect(last?.acked).toBe(7);
  });

  it('500ms 안에 확인이 없으면 acked null 유지, 창이 닫힌 뒤 ACK는 무시', () => {
    connected();
    padTableSync.push(profile(STICK_PADS));
    vi.advanceTimersByTime(600);
    expect(last).toMatchObject({ sent: 7, acked: null });
    ack(7);
    expect(last?.acked).toBeNull();
  });

  it('연결이 끊기면 상태 null, 재연결 후 push는 다시 보낸다', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS));
    src.set('disconnected');
    expect(last).toBeNull();
    padTableSync.push(profile(STICK_PADS));
    expect(src.sent).toHaveLength(3);
    src.set('connected');
    padTableSync.push(profile(STICK_PADS));
    expect(src.sent).toHaveLength(6);
  });

  it('소스를 null로 바꾸면 상태 null', () => {
    connected();
    padTableSync.push(profile(STICK_PADS));
    padTableSync.setSource(null);
    expect(last).toBeNull();
  });
});
