import { describe, expect, it } from 'vitest';
import { decodePacket } from '@/input/stickProtocol';
import { buildHit, buildLog, buildPose } from '@/features/monitor/core/mockStick';
import { PacketLog, type LogRow } from './packetLog';
import { bytesToHex, downloadJsonl, hexToBytes, parseJsonl, Recorder, serializeRow, type RecordingMeta } from './recorder';
import type { PacketRecord } from '@/input/packetTap';
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';

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

describe('diag 줄', () => {
  const miss = (t: number): DiagEvent => ({ type: 'missed', noteIndex: 1, pad: 'SNARE', songTimeMs: 500, t });
  const resolvedEv = (t: number): DiagEvent => ({
    type: 'resolved',
    t,
    hit: { id: 1, stickId: 0, pad: 'SNARE', velocity: 90, tHit: 1, tRecv: 2, tResolved: 3 } as ResolvedHit,
  });

  it('왕복: kind diag 줄로 쓰고 t를 되살리며 패킷과 도착 순서를 지킨다', () => {
    const rows = makeRows();
    const rec = new Recorder();
    rec.start({ ...meta, inputMode: 'follow' });
    rec.append(rows[0]);
    rec.appendDiag(miss(15));
    rec.append(rows[1]);
    expect(rec.lineCount).toBe(3);
    const text = rec.stop();
    const lines = text.split('\n');
    expect(JSON.parse(lines[2])).toEqual({ kind: 'diag', t: 15, ev: { type: 'missed', noteIndex: 1, pad: 'SNARE', songTimeMs: 500 } });
    expect(JSON.parse(lines[1]).kind).toBeUndefined();
    const parsed = parseJsonl(text);
    expect(parsed.meta.inputMode).toBe('follow');
    expect(parsed.rows.length).toBe(2);
    expect(parsed.diags).toEqual([miss(15)]);
  });

  it('늦게 채워진 tAudio가 파일에 남는다(stop에서 직렬화)', () => {
    const rec = new Recorder();
    rec.start(meta);
    const ev = resolvedEv(10);
    rec.appendDiag(ev);
    if (ev.type === 'resolved') ev.hit.tAudio = 9;
    const parsed = parseJsonl(rec.stop());
    const got = parsed.diags[0];
    expect(got.type === 'resolved' && got.hit.tAudio).toBe(9);
  });

  it('attachDiag는 구독 해제 뒤와 녹화 밖 이벤트를 무시한다', () => {
    let listener: ((ev: DiagEvent) => void) | null = null;
    const sub = (l: (ev: DiagEvent) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    };
    const rec = new Recorder();
    rec.start(meta);
    const off = rec.attachDiag(sub);
    listener!(miss(1));
    off();
    expect(listener).toBeNull();
    expect(rec.lineCount).toBe(1);
    rec.stop();
    rec.appendDiag(miss(2));
    expect(rec.lineCount).toBe(1);
  });

  it('모르는 kind는 건너뛰고 이전 형식 파일은 diags가 빈 배열이다', () => {
    const rows = makeRows();
    const row = serializeRow(rows[0]);
    const withUnknown = [JSON.stringify(meta), row, JSON.stringify({ kind: 'future', t: 1 }), ''].join('\n');
    const p = parseJsonl(withUnknown);
    expect(p.rows.length).toBe(1);
    expect(p.diags).toEqual([]);
    const old = parseJsonl([JSON.stringify(meta), row].join('\n'));
    expect(old.rows.length).toBe(1);
    expect(old.diags).toEqual([]);
  });
});

describe('downloadJsonl', () => {
  it('document가 없으면 무동작', () => {
    expect(() => downloadJsonl('x')).not.toThrow();
  });
});

describe('패킷 줄 role (PLAY-002 실연주 진단)', () => {
  it('손은 role 0·1, 페달은 stick null·role 2, OUT은 role null로 남는다', () => {
    const log = new PacketLog();
    log.ingest(mk(buildHit({ role: 1, seq: 1, timestampUs: 0, pad: 2 }), 10));
    log.ingest(mk(buildHit({ role: 2, seq: 2, timestampUs: 0, pad: 0 }), 20));
    log.ingest(mk(new Uint8Array([0x14, 0x02, 20, 0]), 30, 'out'));
    const lines = log.rows().map((r) => JSON.parse(serializeRow(r)) as { stick: number | null; role: number | null });
    expect(lines.map((l) => [l.stick, l.role])).toEqual([
      [1, 1],
      [null, 2],
      [null, null],
    ]);
  });

  it('role이 없는 이전 형식 줄도 그대로 되읽는다', () => {
    const old = JSON.stringify({ t: 5, dir: 'in', transport: 'serial', stick: 0, hex: '0102', decoded: null });
    const diag = JSON.stringify({ kind: 'diag', t: 6, ev: { type: 'clock', offsets: [1, 2, null, null], source: 'serial' } });
    const { rows, diags } = parseJsonl([JSON.stringify(meta), old, diag].join('\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0].stick).toBe(0);
    expect(rows[0].role).toBeUndefined();
    expect(diags[0]).toMatchObject({ type: 'clock', t: 6 });
  });
});

describe('vis 줄 (녹화 탭 숨김, PLAY-006)', () => {
  it('녹화 중 appendVis는 kind vis 줄(t·hidden)을 남기고 되읽으면 vis로 나온다', () => {
    const rows = makeRows();
    const rec = new Recorder();
    rec.start(meta);
    rec.append(rows[0]);
    rec.appendVis(true, 100);
    rec.appendVis(false, 4100);
    const text = rec.stop();
    const lines = text.split('\n');
    expect(JSON.parse(lines[2])).toEqual({ kind: 'vis', t: 100, hidden: true });
    expect(JSON.parse(lines[3])).toEqual({ kind: 'vis', t: 4100, hidden: false });
    const parsed = parseJsonl(text);
    expect(parsed.vis).toEqual([
      { t: 100, hidden: true },
      { t: 4100, hidden: false },
    ]);
    // 패킷 행·진단 이벤트에는 섞이지 않는다
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.diags).toEqual([]);
  });

  it('녹화 중이 아니면 무시한다', () => {
    const rec = new Recorder();
    rec.appendVis(true, 1);
    rec.start(meta);
    expect(rec.stop().split('\n')).toHaveLength(1);
    rec.appendVis(false, 2);
    expect(rec.stop().split('\n')).toHaveLength(1);
  });

  it('옛 파일(vis 줄 없음)은 vis가 빈 배열이고 모르는 kind는 여전히 건너뛴다', () => {
    const text = [JSON.stringify(meta), JSON.stringify({ kind: 'future', t: 1 }), JSON.stringify({ kind: 'vis', t: 5, hidden: 'yes' })].join('\n');
    const parsed = parseJsonl(text);
    expect(parsed.vis).toEqual([]);
    expect(parsed.rows).toEqual([]);
  });
});
