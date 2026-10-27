import { describe, expect, it } from 'vitest';
import { decodePacket } from '@/input/stickProtocol';
import { buildHit, buildLog, buildPose } from './mockStick';
import { PacketLog, type LogRow } from './packetLog';
import { bytesToHex, downloadJsonl, hexToBytes, parseJsonl, Recorder, serializeRow, type RecordingMeta } from './recorder';
import type { PacketRecord } from '@/input/packetTap';

const meta: RecordingMeta = {
  startedAt: '2026-10-23T00:00:00.000Z',
  source: { kind: 'mock', label: '모의 스틱' },
  firmware: '0.1',
  build: 'BOOT 0.1 mock000',
  profile: [{ pad: 'SNARE', pitch: 10, yaw: -5, radiusDeg: 12 }],
  note: '테스트',
};

let id = 1;
const mk = (bytes: Uint8Array, t: number, dir: 'in' | 'out' = 'in'): PacketRecord => ({
  id: id++,
  dir,
  transport: 'mock',
  stickId: null,
  bytes,
  recvTime: t,
});

function makeRows(): LogRow[] {
  const log = new PacketLog();
  log.ingest(mk(buildHit({ role: 1, seq: 9, timestampUs: 123456, pad: 2, marginDeg: 3.5, elevationDeg: 12.34, ambiguous: true }), 10));
  log.ingest(mk(buildPose({ timestampUs: 5000, elevationDeg: -1.5, azimuthDeg: 20, rollDeg: 3, seq: 4 }), 20));
  log.ingest(mk(buildLog('drop weak 320'), 30));
  log.ingest(mk(buildHit({ seq: 1, timestampUs: 0, pad: 0 }).slice(0, 19), 40));
  log.ingest(mk(new Uint8Array([0x14, 0x02, 20, 0]), 50, 'out'));
  return [...log.rows()];
}

/** 같은 방식으로 직렬화한 decoded 비교용 */
const plain = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Uint8Array || x instanceof Int16Array ? Array.from(x) : x)));

describe('hex', () => {
  it('공백 없는 대문자 왕복', () => {
    const b = new Uint8Array([0x01, 0xa3, 0x00, 0xff]);
    expect(bytesToHex(b)).toBe('01A300FF');
    expect(hexToBytes('01A300FF')).toEqual(b);
  });
});

describe('직렬화·되읽기', () => {
  it('첫 줄 meta, 행의 decoded는 hex를 다시 디코드한 것과 같다', () => {
    const rows = makeRows();
    const rec = new Recorder();
    rec.start(meta);
    expect(rec.recording).toBe(true);
    for (const r of rows) rec.append(r);
    expect(rec.lineCount).toBe(5);
    const text = rec.stop();
    expect(rec.recording).toBe(false);

    const lines = text.split('\n');
    expect(JSON.parse(lines[0])).toEqual(meta);

    const parsed = parseJsonl(text);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.rows.length).toBe(5);
    parsed.rows.forEach((p, i) => {
      expect(p.hex).toMatch(/^[0-9A-F]+$/);
      expect(p.t).toBe(rows[i].t);
      if (p.dir === 'out') {
        expect(p.decoded).toBeNull();
        expect(p.outType).toBe(0x14);
      } else {
        expect(p.decoded).toEqual(plain(decodePacket(hexToBytes(p.hex), p.t)));
      }
    });
    expect((parsed.rows[3].decoded as { kind: string; bytes: number[] }).kind).toBe('error');
    expect((parsed.rows[3].decoded as { bytes: number[] }).bytes.length).toBe(19);
  });

  it('serializeRow는 한 줄 JSON', () => {
    const [r] = makeRows();
    const s = serializeRow(r);
    expect(s.includes('\n')).toBe(false);
    expect(JSON.parse(s)).toMatchObject({ dir: 'in', transport: 'mock', stick: 1 });
  });

  it('녹화 전·후에는 append가 무시된다', () => {
    const rec = new Recorder();
    const [r] = makeRows();
    rec.append(r);
    expect(rec.lineCount).toBe(0);
  });

  it('attach는 packetLog의 새 행만 녹화한다', () => {
    const log = new PacketLog();
    log.ingest(mk(buildLog('old'), 0));
    const rec = new Recorder();
    rec.start(meta);
    const off = rec.attach(log);
    log.ingest(mk(buildLog('new1'), 1));
    log.ingest(mk(buildLog('new2'), 2));
    off();
    log.ingest(mk(buildLog('after'), 3));
    expect(rec.lineCount).toBe(2);
  });
});

describe('downloadJsonl', () => {
  it('document가 없으면 무동작', () => {
    expect(() => downloadJsonl('x')).not.toThrow();
  });
});
