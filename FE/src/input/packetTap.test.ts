import { describe, expect, it, vi } from 'vitest';
import { packetTap } from './packetTap';

const rec = (n: number) => ({ dir: 'in' as const, transport: 'ws' as const, stickId: null, bytes: new Uint8Array([n]), recvTime: n });

describe('packetTap', () => {
  it('구독자에게 id를 붙여 전달하고 id는 증가한다', () => {
    const fn = vi.fn();
    const off = packetTap.subscribe(fn);
    packetTap.publish(rec(1));
    packetTap.publish(rec(2));
    off();
    expect(fn).toHaveBeenCalledTimes(2);
    const [a, b] = fn.mock.calls.map((c) => c[0]);
    expect(b.id).toBe(a.id + 1);
    expect(a.bytes[0]).toBe(1);
    expect(a.dir).toBe('in');
  });

  it('구독 해제 후에는 받지 않는다', () => {
    const fn = vi.fn();
    const off = packetTap.subscribe(fn);
    off();
    packetTap.publish(rec(3));
    expect(fn).not.toHaveBeenCalled();
    expect(packetTap.active).toBe(false);
  });

  it('구독자가 없어도 publish는 무해하다', () => {
    expect(() => packetTap.publish(rec(4))).not.toThrow();
  });

  it('구독자가 있으면 active', () => {
    const off = packetTap.subscribe(() => {});
    expect(packetTap.active).toBe(true);
    off();
  });
});
