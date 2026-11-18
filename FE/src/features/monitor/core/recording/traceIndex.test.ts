import { describe, expect, it } from 'vitest';
import type { DiagBody, DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import type { LogRow } from './packetLog';
import { buildTrace, entryMatches, indexOfSelection, traceList, type TraceSources } from './traceIndex';

const ev = (b: DiagBody, t: number): DiagEvent => ({ ...b, t }) as DiagEvent;

const hit = (over: Partial<ResolvedHit> = {}): ResolvedHit => ({
  id: 1,
  stickId: 0,
  pad: 'SNARE',
  velocity: 80,
  tHit: 998,
  tRecv: 1000,
  tResolved: 1003,
  tAudio: 1030,
  source: 'ble',
  pose: { pitch: 0, yaw: 0 },
  peakAccel: 6,
  judgedBy: 'stick',
  seq: 7,
  distanceDeg: 4.5,
  inside: true,
  ...over,
});

const hitRow = (t: number, seq: number, over: Partial<LogRow> = {}): LogRow =>
  ({
    id: Math.round(t),
    t,
    dir: 'in',
    transport: 'ble',
    stick: 0,
    bytes: new Uint8Array([0x01, 0xab]),
    decoded: {
      kind: 'hit',
      seq,
      pad: 'SNARE',
      velocity: 90,
      timestampUs: 123456,
      peakSpeedDps: 800,
      marginDeg: 3,
      elevationDeg: 1,
      azimuthDeg: 2,
      swingMs: 40,
      lateralDeg: 0.5,
      decel: 1.2,
      magAnomaly: false,
      ambiguous: true,
    },
    outType: null,
    tBrowser: 997,
    futureMs: -3,
    log: null,
    ...over,
  }) as unknown as LogRow;

const resolved = (h: ResolvedHit): DiagEvent => ev({ type: 'resolved', hit: h }, h.tResolved);
const judged = (hitId: number, over: Partial<Extract<DiagBody, { type: 'judged' }>> = {}): DiagEvent =>
  ev(
    {
      type: 'judged',
      hitId,
      judgement: 'PERFECT',
      noteIndex: 3,
      notePad: 'SNARE',
      hitPad: 'SNARE',
      deltaMs: -5,
      songTimeMs: 2000,
      ...over,
    },
    1004,
  );

const src = (rows: LogRow[], events: DiagEvent[], swing: string[] = []): TraceSources => ({
  rows,
  events,
  hasSwing: (k) => swing.includes(k),
});

describe('buildTrace', () => {
  it('스틱 타격: 전 단계가 채워지고 SWING 키가 붙는다', () => {
    const s = src([hitRow(1001, 7)], [resolved(hit()), judged(1)], ['0-7']);
    for (const sel of [
      { kind: 'hit', hitId: 1 } as const,
      { kind: 'packet', stick: 0, seq: 7, t: 1001 } as const,
    ]) {
      const c = buildTrace(sel, s)!;
      expect(Object.values(c.stages).every((st) => st.ok)).toBe(true);
      expect(c.swingKey).toBe('0-7');
      expect(c.summary).toMatchObject({ stick: 0, seq: 7, hitId: 1, pad: 'SNARE', judge: 'PERFECT' });
    }
    const out = buildTrace({ kind: 'hit', hitId: 1 }, s)!.stages.output;
    expect(out.ok && out.items.map((i) => i.value)).toEqual(['1030.0', '27.0', '32.0']);
  });

  it('키보드 타격: ①②③은 패킷 없음, ④⑤⑥은 채워진다', () => {
    const k = hit({ id: 2, source: 'keyboard', seq: undefined, stickId: 1 });
    const c = buildTrace({ kind: 'hit', hitId: 2 }, src([hitRow(1001, 7)], [resolved(k), judged(2)]))!;
    for (const key of ['transport', 'sensor', 'clock'] as const) {
      expect(c.stages[key]).toEqual({ ok: false, reason: '없음: 키보드·포인터 입력은 패킷이 없음' });
    }
    expect(c.stages.resolve.ok && c.stages.score.ok && c.stages.output.ok).toBe(true);
    expect(c.swingKey).toBeNull();
  });

  it('모의 패킷만: ①②③만 채워지고 ④⑤⑥은 판정 경로 밖 이유', () => {
    const c = buildTrace({ kind: 'packet', stick: 0, seq: 7, t: 1001 }, src([hitRow(1001, 7, { transport: 'mock' })], []))!;
    expect(c.stages.transport.ok && c.stages.sensor.ok && c.stages.clock.ok).toBe(true);
    for (const key of ['resolve', 'score', 'output'] as const) {
      const st = c.stages[key];
      expect(!st.ok && st.reason).toContain('모의 스틱');
    }
  });

  it('실기 패킷인데 resolved가 없으면 일반 이유', () => {
    const c = buildTrace({ kind: 'packet', stick: 0, seq: 7, t: 1001 }, src([hitRow(1001, 7)], []))!;
    const st = c.stages.resolve;
    expect(!st.ok && st.reason).toContain('판정 기록을 찾지 못함');
  });

  it('stray: 판정 대신 stray로 표시, 세션 밖이면 ⑤ 연주 중 아님', () => {
    const s = src([hitRow(1001, 7)], [resolved(hit()), judged(1, { judgement: null, noteIndex: null, notePad: null, deltaMs: null })]);
    const c = buildTrace({ kind: 'hit', hitId: 1 }, s)!;
    expect(c.summary.judge).toBe('stray');
    const sc = c.stages.score;
    expect(sc.ok && sc.items.find((i) => i.label === '판정')?.value).toContain('stray');

    const none = buildTrace({ kind: 'hit', hitId: 1 }, src([hitRow(1001, 7)], [resolved(hit())]))!;
    expect(none.stages.score).toEqual({ ok: false, reason: '연주 중 아님(채점 세션 밖 타격)' });
  });

  it('tAudio가 없으면 ⑥ 오디오 예약 없음', () => {
    const c = buildTrace({ kind: 'hit', hitId: 1 }, src([hitRow(1001, 7)], [resolved(hit({ tAudio: undefined }))]))!;
    const st = c.stages.output;
    expect(!st.ok && st.reason).toContain('오디오 예약 없음');
  });

  it('seq 순환: 2초 밖의 같은 seq는 묶지 않는다', () => {
    // 행은 5초 전 seq 7, resolved는 지금 seq 7
    const rows = [hitRow(-4000, 7)];
    const c = buildTrace({ kind: 'hit', hitId: 1 }, src(rows, [resolved(hit()), judged(1)]))!;
    expect(c.stages.transport.ok).toBe(false);
    expect(c.stages.resolve.ok).toBe(true);
    // 반대로 패킷 선택에서도 먼 resolved는 짝이 아니다
    const p = buildTrace({ kind: 'packet', stick: 0, seq: 7, t: -4000 }, src(rows, [resolved(hit())]))!;
    expect(p.stages.transport.ok).toBe(true);
    expect(p.stages.resolve.ok).toBe(false);
  });

  it('둘 다 못 찾으면 null', () => {
    expect(buildTrace({ kind: 'hit', hitId: 9 }, src([], []))).toBeNull();
  });
});

describe('traceList', () => {
  it('resolved와 짝 HIT 행은 합치고, 짝 없는 행은 따로, 최신 먼저', () => {
    const rows = [hitRow(500, 3), hitRow(1001, 7), hitRow(3000, 9)];
    const events = [resolved(hit()), judged(1)];
    const list = traceList(rows, events);
    expect(list.map((e) => [e.seq, e.hitId, e.sel.kind])).toEqual([
      [9, null, 'packet'],
      [7, 1, 'hit'],
      [3, null, 'packet'],
    ]);
    expect(list[1].judge).toBe('PERFECT');
    expect(list[1].rowT).toBe(1001);
  });

  it('seq 순환 오매칭 없이 별개 행이 된다', () => {
    const list = traceList([hitRow(-4000, 7)], [resolved(hit())]);
    expect(list).toHaveLength(2);
  });

  it('limit과 선택 위치 계산', () => {
    const rows = [hitRow(100, 1), hitRow(200, 2), hitRow(300, 3)];
    const list = traceList(rows, [], 2);
    expect(list.map((e) => e.seq)).toEqual([3, 2]);
    expect(indexOfSelection(list, { kind: 'packet', stick: 0, seq: 2, t: 200 })).toBe(1);
    expect(indexOfSelection(list, null)).toBe(-1);
  });

  it('패킷 선택도 짝 resolved가 있는 행과 맞는다', () => {
    const list = traceList([hitRow(1001, 7)], [resolved(hit())]);
    expect(entryMatches(list[0], { kind: 'packet', stick: 0, seq: 7, t: 1001 })).toBe(true);
    expect(entryMatches(list[0], { kind: 'hit', hitId: 1 })).toBe(true);
    expect(entryMatches(list[0], { kind: 'hit', hitId: 2 })).toBe(false);
  });
});
