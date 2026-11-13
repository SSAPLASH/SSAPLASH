// 손별 패드 표 전송·지우기·적용 확인 검증(PLAY-004).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationProfile, PadAnchor, PadTableStatus } from '@/domain/kit/calibration/calibration';
import type { InputSourceKind, SourceState } from '@/domain/events';
import { STICK_PADS, type PadId } from '@/domain/kit/pads';
import { BaseInputSource } from './source/InputSource';
import { packetTap } from './packetTap';
import { padTableSync } from './padTableSync';

class MockSource extends BaseInputSource {
  readonly kind = 'ws' as InputSourceKind;
  readonly label = 'mock';
  sent: Uint8Array[] = [];
  /** sendCommand 둘째 인자(대상 손) 기록 */
  targets: Array<number | undefined> = [];
  sendCommand(bytes: Uint8Array, stickId?: number): void {
    this.sent.push(bytes);
    this.targets.push(stickId);
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
/** PARAM_ACK. role은 flags 하위 2비트. stickId는 레코드(BLE형)가 손을 아는 경우 */
const ack = (value: number, role = 0, paramId = PARAM_ACK_PAD_TABLE, stickId: 0 | 1 | null = null) =>
  packetTap.publish({
    dir: 'in',
    transport: 'ws',
    stickId,
    bytes: new Uint8Array([0x06, role, paramId, value & 0xff, (value >> 8) & 0xff]),
    recvTime: 0,
  });

let last: [PadTableStatus | null, PadTableStatus | null];

beforeEach(() => {
  vi.useFakeTimers();
  padTableSync.reset();
  last = [null, null];
  padTableSync.onStatus((id, st) => {
    last[id] = st;
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

describe('padTableSync push', () => {
  it('7앵커 → 패킷당 2개로 4패킷, 첫 패킷은 지우고 시작, 모두 그 손으로 ROUTE', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 1 });
    expect(STICK_PADS).toHaveLength(7);
    expect(src.sent).toHaveLength(4);
    expect(src.sent[0][0]).toBe(0x15);
    expect(src.sent.map((b) => b[1])).toEqual([0x82, 0x02, 0x02, 0x01]);
    expect(src.sent[0][2]).toBe(0); // 첫 항목 CRASH(pad 0)
    expect(src.targets).toEqual([1, 1, 1, 1]);
    expect(last[1]).toMatchObject({ sent: 7, acked: null, target: 1 });
    expect(last[0]).toBeNull();
  });

  it('같은 손에 같은 표는 다시 보내지 않고, 반올림 안의 변화는 무시·0.1° 변화는 재송신. force는 같은 표여도 보낸다', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(src.sent).toHaveLength(4);
    padTableSync.push(profile(STICK_PADS, 0.001), { stickId: 0 });
    expect(src.sent).toHaveLength(4);
    padTableSync.push(profile(STICK_PADS, 0.1), { stickId: 0 });
    expect(src.sent).toHaveLength(8);
    padTableSync.push(profile(STICK_PADS, 0.1), { stickId: 0, force: true });
    expect(src.sent).toHaveLength(12);
  });

  it('해시는 손별: 왼손에 보낸 표가 오른손 첫 전송을 막지 않는다', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    padTableSync.push(profile(STICK_PADS), { stickId: 1 });
    expect(src.sent).toHaveLength(8);
    expect(src.targets.slice(4)).toEqual([1, 1, 1, 1]);
  });

  it('미연결·sendCommand 없는 소스·소스 없음은 무동작, 상태 null', () => {
    const src = new MockSource();
    padTableSync.setSource(src);
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(src.sent).toHaveLength(0);
    const nocmd = new NoCmdSource();
    padTableSync.setSource(nocmd);
    nocmd.set('connected');
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    padTableSync.setSource(null);
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(last).toEqual([null, null]);
  });

  it('페달 앵커는 걸러진다', () => {
    const src = connected();
    padTableSync.push(profile([...STICK_PADS.slice(0, 2), 'KICK', 'HIHAT_PEDAL']), { stickId: 0 });
    expect(src.sent).toHaveLength(1);
    expect(src.sent[0][1]).toBe(0x82);
    expect(last[0]?.sent).toBe(2);
  });
});

describe('padTableSync ACK', () => {
  it('PARAM_ACK 0x20은 패킷 role의 손에 반영되고 마지막 값이 남는다. 다른 paramId는 무시', () => {
    connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 1 });
    ack(2, 1);
    ack(4, 1);
    ack(7, 1);
    expect(last[1]).toMatchObject({ sent: 7, acked: 7 });
    ack(5, 1, 0x01);
    expect(last[1]?.acked).toBe(7);
    expect(last[0]).toBeNull();
  });

  it('레코드가 손을 알면(BLE) role보다 우선한다', () => {
    connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    ack(7, 1, PARAM_ACK_PAD_TABLE, 0);
    expect(last[0]?.acked).toBe(7);
  });

  it('창이 열린 손에 온 ACK만 반영되고, 500ms 뒤 ACK는 무시', () => {
    connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    ack(7, 1); // 오른손 창은 안 열림
    expect(last[0]?.acked).toBeNull();
    vi.advanceTimersByTime(600);
    ack(7, 0);
    expect(last[0]?.acked).toBeNull();
  });

  it('연결이 끊기면 양손 상태 null, 재연결 후 push는 다시 보낸다', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    src.set('disconnected');
    expect(last[0]).toBeNull();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(src.sent).toHaveLength(4);
    src.set('connected');
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(src.sent).toHaveLength(8);
  });
});

describe('padTableSync clear (D6)', () => {
  it('지우기 전용 패킷 [0x15, 0x80] 하나를 그 손에 보내고 sent 0으로 보고, ACK 0은 acked 0', () => {
    const src = connected();
    padTableSync.clear(1);
    expect(src.sent).toHaveLength(1);
    expect([...src.sent[0]]).toEqual([0x15, 0x80]);
    expect(src.targets).toEqual([1]);
    expect(last[1]).toMatchObject({ sent: 0, acked: null, target: 1 });
    ack(0, 1);
    expect(last[1]?.acked).toBe(0);
  });

  it('clear 뒤에는 같은 표라도 push가 다시 나간다(해시 초기화)', () => {
    const src = connected();
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    padTableSync.clear(0);
    padTableSync.push(profile(STICK_PADS), { stickId: 0 });
    expect(src.sent).toHaveLength(4 + 1 + 4);
  });

  it('보낼 수 없으면 무동작', () => {
    const src = new MockSource();
    padTableSync.setSource(src);
    padTableSync.clear(0);
    expect(src.sent).toHaveLength(0);
    expect(last[0]).toBeNull();
  });
});
