import { describe, expect, it } from 'vitest';
import { FrameDecoder, crc8, frame } from './serialFraming';

const ascii = (s: string) => new TextEncoder().encode(s);
const bytes = (...n: number[]) => new Uint8Array(n);
const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
};

describe('crc8', () => {
  it('빈 입력은 0x00', () => {
    expect(crc8(new Uint8Array(0))).toBe(0x00);
  });
  it('CRC-8/SMBUS 표준 벡터 "123456789" = 0xF4', () => {
    expect(crc8(ascii('123456789'))).toBe(0xf4);
  });
});

describe('frame', () => {
  it('[SOF, LEN, payload, CRC]로 감싼다', () => {
    const p = bytes(1, 2, 3);
    expect(Array.from(frame(p))).toEqual([0xa5, 3, 1, 2, 3, crc8(p)]);
  });
  it('길이 0 또는 255 초과면 예외', () => {
    expect(() => frame(new Uint8Array(0))).toThrow();
    expect(() => frame(new Uint8Array(256))).toThrow();
    expect(frame(new Uint8Array(255)).length).toBe(258);
  });
});

describe('FrameDecoder', () => {
  it('정상 1프레임', () => {
    const d = new FrameDecoder();
    const out = d.push(frame(bytes(9, 8, 7)));
    expect(out.map((o) => Array.from(o))).toEqual([[9, 8, 7]]);
    expect(d.stats()).toEqual({ crcErrors: 0, resyncCount: 0, droppedBytes: 0 });
  });

  it('한 chunk에 2프레임', () => {
    const d = new FrameDecoder();
    const out = d.push(cat(frame(bytes(1, 2)), frame(bytes(3, 4, 5))));
    expect(out.map((o) => Array.from(o))).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it('1바이트씩 쪼개 넣어도 복원한다', () => {
    const d = new FrameDecoder();
    const all = cat(frame(bytes(1, 2)), frame(bytes(3, 4, 5)));
    const out: number[][] = [];
    for (const b of all) for (const p of d.push(bytes(b))) out.push(Array.from(p));
    expect(out).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
    expect(d.stats().droppedBytes).toBe(0);
  });

  it('앞 쓰레기 3바이트는 버리고 dropped 3, resync 1', () => {
    const d = new FrameDecoder();
    const out = d.push(cat(bytes(0x11, 0x22, 0x33), frame(bytes(5, 6))));
    expect(out.map((o) => Array.from(o))).toEqual([[5, 6]]);
    expect(d.stats()).toEqual({ crcErrors: 0, resyncCount: 1, droppedBytes: 3 });
  });

  it('CRC가 깨진 프레임 뒤의 정상 프레임을 복원한다', () => {
    const d = new FrameDecoder();
    const bad = frame(bytes(1, 2, 3));
    bad[bad.length - 1] ^= 0xff;
    const out = d.push(cat(bad, frame(bytes(4, 5))));
    expect(out.map((o) => Array.from(o))).toEqual([[4, 5]]);
    expect(d.stats().crcErrors).toBe(1);
  });

  it('payload 안에 0xA5가 있어도 정상 복원', () => {
    const d = new FrameDecoder();
    const out = d.push(frame(bytes(0xa5, 0xa5, 1, 0xa5)));
    expect(out.map((o) => Array.from(o))).toEqual([[0xa5, 0xa5, 1, 0xa5]]);
    expect(d.stats().crcErrors).toBe(0);
  });

  it('CRC 불일치 시 SOF 다음부터 재탐색해 안쪽에 숨은 진짜 프레임을 찾는다', () => {
    const d = new FrameDecoder();
    const inner = frame(bytes(7, 7, 7));
    // 가짜 SOF + LEN(10)이 안쪽 프레임을 삼키지만 CRC가 맞지 않는다
    const outer = cat(bytes(0xa5, 10), inner, new Uint8Array(10));
    const out = d.push(outer);
    expect(out.map((o) => Array.from(o))).toEqual([[7, 7, 7]]);
    expect(d.stats().crcErrors).toBe(1);
  });

  it('LEN이 maxLen을 넘으면 즉시 불일치로 보고 다음 프레임을 찾는다', () => {
    const d = new FrameDecoder(8);
    const out = d.push(cat(bytes(0xa5, 200), frame(bytes(1))));
    expect(out.map((o) => Array.from(o))).toEqual([[1]]);
  });

  it('frame→push 왕복: 20바이트 HIT', () => {
    const hit = new Uint8Array(20);
    hit[0] = 0x01;
    for (let i = 1; i < 20; i++) hit[i] = (i * 37) & 0xff;
    const d = new FrameDecoder();
    const out = d.push(frame(hit));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0])).toEqual(Array.from(hit));
  });

  it('reset은 버퍼와 통계를 비운다', () => {
    const d = new FrameDecoder();
    d.push(bytes(1, 2, 0xa5, 5));
    d.reset();
    expect(d.stats()).toEqual({ crcErrors: 0, resyncCount: 0, droppedBytes: 0 });
    expect(d.push(frame(bytes(1))).length).toBe(1);
  });
});
