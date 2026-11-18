import { describe, expect, it } from 'vitest';
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import { HEALTH_THRESHOLDS } from '@/features/monitor/core/health';
import type { RecordedRow, RecordingMeta } from './recorder';
import { summarizeRecording, summaryToMarkdown } from './recordingSummary';

const meta: RecordingMeta = {
  startedAt: '2026-10-27T01:02:03.000Z',
  source: { kind: 'mock', label: '모의 스틱' },
  firmware: null,
  build: null,
  profile: null,
  note: '실측 1회차',
  inputMode: 'direct',
};

/** 송신 SYNC 행. hex = 타입 0x10 + u32 t0(LE) */
const syncOut = (t: number, key: number): RecordedRow => {
  const b = new Uint8Array(5);
  b[0] = 0x10;
  new DataView(b.buffer).setUint32(1, key, true);
  return {
    t,
    dir: 'out',
    transport: 'mock',
    stick: null,
    hex: Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(''),
    decoded: null,
    outType: 0x10,
  };
};
const syncAck = (t: number, key: number, stick: 0 | 1): RecordedRow => ({
  t,
  dir: 'in',
  transport: 'mock',
  stick,
  hex: '',
  decoded: { kind: 'syncAck', t0Ms: key },
});
const hitRow = (t: number): RecordedRow => ({ t, dir: 'in', transport: 'mock', stick: 0, hex: '', decoded: { kind: 'hit' } });

const resolved = (tHit: number, recv: number, resolve: number, audio?: number): DiagEvent => {
  const hit = { tHit, tRecv: tHit + recv, tResolved: tHit + recv + resolve } as ResolvedHit;
  if (audio !== undefined) hit.tAudio = hit.tResolved + audio;
  return { type: 'resolved', hit, t: hit.tResolved };
};
const judged = (judgement: 'PERFECT' | 'GOOD' | 'MISS' | null, deltaMs: number | null): DiagEvent => ({
  type: 'judged',
  hitId: 1,
  judgement,
  noteIndex: judgement ? 0 : null,
  notePad: null,
  hitPad: null,
  deltaMs,
  songTimeMs: 0,
  t: 0,
});

describe('summarizeRecording', () => {
  it('패킷 수를 종류별로 센다', () => {
    const s = summarizeRecording({
      meta,
      rows: [hitRow(1), hitRow(2), syncOut(3, 7), syncAck(4, 7, 0)],
      diags: [],
    });
    expect(s.packets.in).toEqual({ hit: 2, syncAck: 1 });
    expect(s.packets.inTotal).toBe(3);
    expect(s.packets.out).toEqual({ '0x10': 1 });
    expect(s.packets.hits).toBe(2);
  });

  it('rtt는 t0 키로 스틱마다 한 번씩 짝짓고 못 찾으면 제외한다', () => {
    const rows = [
      syncOut(100, 5000),
      syncAck(110, 5000, 0),
      syncAck(130, 5000, 1),
      syncAck(140, 5000, 0), // 이미 짝지은 스틱: 제외
      syncAck(150, 9999, 0), // 키 불일치: 제외
      syncOut(3000, 6000),
      syncAck(3040, 6000, 0),
    ];
    const s = summarizeRecording({ meta, rows, diags: [] });
    // rtt 10, 30, 40
    expect(s.rtt.n).toBe(3);
    expect(s.rtt.p50).toBe(30);
    expect(s.rtt.max).toBe(40);
    expect(s.rtt.p95).toBeCloseTo(39, 5);
    expect(s.rtt.threshold).toEqual({ stat: 'p50', warn: HEALTH_THRESHOLDS.clock.rttWarnMs });
  });

  it('구간 지연 분위수: tAudio가 없는 타격은 audio·total에서 빠진다', () => {
    const diags = [resolved(0, 2, 1, 4), resolved(100, 4, 3, 6), resolved(200, 6, 5)];
    const s = summarizeRecording({ meta, rows: [], diags });
    expect(s.latency.recv).toMatchObject({ n: 3, p50: 4, max: 6, threshold: null });
    expect(s.latency.resolve).toMatchObject({ n: 3, p50: 3, max: 5 });
    expect(s.latency.audio).toMatchObject({ n: 2, p50: 5, max: 6 });
    expect(s.latency.audio.threshold?.warn).toBe(HEALTH_THRESHOLDS.output.audioP95WarnMs);
    // total = tAudio − tHit: 7, 13
    expect(s.latency.total).toMatchObject({ n: 2, p50: 10, max: 13 });
    expect(s.latency.total.threshold?.warn).toBe(HEALTH_THRESHOLDS.output.totalP95WarnMs);
  });

  it('채점: delta 통계·판정 카운트·stray·무타격·세션', () => {
    const diags: DiagEvent[] = [
      judged('PERFECT', -4),
      judged('GOOD', 8),
      judged('MISS', null),
      judged(null, null), // stray
      judged(null, null),
      { type: 'missed', noteIndex: 3, pad: 'SNARE', songTimeMs: 10, t: 0 },
      {
        type: 'session',
        phase: 'start',
        mode: 'RHYTHM',
        songId: 's',
        title: '곡 A',
        chartVersionId: 1,
        windows: { perfectMs: 50, goodMs: 100 } as never,
        audioOffsetMs: 12,
        noteCount: 10,
        t: 0,
      } as unknown as DiagEvent, // 옛 녹화: kickOffsetMs 없음
    ];
    const s = summarizeRecording({ meta, rows: [], diags });
    expect(s.delta).toMatchObject({ n: 2, mean: 2, p50: 2, max: 8 });
    expect(s.delta.threshold).toEqual({
      stat: 'absMean',
      warn: HEALTH_THRESHOLDS.score.deltaMeanWarnMs,
      bad: HEALTH_THRESHOLDS.score.deltaMeanBadMs,
    });
    expect(s.judgements).toEqual({ PERFECT: 1, GOOD: 1, MISS: 1 });
    expect(s.stray).toBe(2);
    expect(s.missed).toBe(1);
    expect(s.sessions).toEqual([{ title: '곡 A', mode: 'RHYTHM', audioOffsetMs: 12, kickOffsetMs: 12, contested: 0, coach: { fixed: { total: 0, byTag: {} }, window: { total: 0, byTag: {} } } }]);
  });

  it('매칭 경합: 세션별·전체 수를 세고 Markdown에 보인다', () => {
    const start = (title: string): DiagEvent => ({
      type: 'session', phase: 'start', mode: 'RHYTHM', songId: title, title, chartVersionId: 1,
      windows: { perfectMs: 25, goodMs: 60 } as never, audioOffsetMs: 0, kickOffsetMs: 0, noteCount: 3, t: 0,
    });
    const c = (hitId: number): DiagEvent => ({
      type: 'matchContested', hitId, songTimeMs: 1055, pad: 'KICK', candidates: [0, 1], picked: 0, rule: 'earliest', t: 0,
    });
    const s = summarizeRecording({ meta, rows: [], diags: [start('곡 A'), c(1), c(2), start('곡 B'), c(3)] });
    expect(s.contested).toBe(3);
    expect(s.sessions.map((x) => x.contested)).toEqual([2, 1]);
    const md = summaryToMarkdown(s);
    expect(md).toContain('매칭 경합');
    expect(md).toContain('| 곡 A | RHYTHM | 0.0 | 2 |');
  });

  it('빈 입력도 요약된다(값은 null)', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [] });
    expect(s.rtt).toMatchObject({ n: 0, p50: null, p95: null, max: null });
    expect(s.delta.mean).toBeNull();
  });
});

describe('summaryToMarkdown', () => {
  it('헤더·표·기준값을 Markdown으로 낸다', () => {
    const s = summarizeRecording({
      meta,
      rows: [hitRow(1), syncOut(100, 5), syncAck(118.46, 5, 0)],
      diags: [resolved(0, 2, 1, 4), judged('PERFECT', -4), judged('GOOD', 8)],
    });
    const md = summaryToMarkdown(s);
    expect(md).toContain('## 녹화 요약');
    expect(md).toContain('- 시작: 2026-10-27T01:02:03.000Z');
    expect(md).toContain('- 소스: 모의 스틱 (mock)');
    expect(md).toContain('- 입력 방식: 직접 연결');
    expect(md).toContain('- 메모: 실측 1회차');
    expect(md).toContain('| 지표 (ms) | n | p50 | p95 | max | 기준 |');
    expect(md).toContain(`| SYNC rtt | 1 | 18.5 | 18.5 | 18.5 | p50 ≤ ${HEALTH_THRESHOLDS.clock.rttWarnMs} |`);
    expect(md).toContain('| 센서→수신 | 1 | 2.0 | 2.0 | 2.0 | – |');
    expect(md).toContain(`| 판정→오디오 | 1 | 4.0 | 4.0 | 4.0 | p95 ≤ ${HEALTH_THRESHOLDS.output.audioP95WarnMs} |`);
    expect(md).toContain('채점 delta 평균: 2.0ms');
    expect(md).toContain('| 1 | 1 | 0 | 0 | 0 |');
  });

  it('값이 없으면 –로 쓰고 이전 형식(inputMode 없음)도 허용한다', () => {
    const { inputMode: _omit, ...old } = meta;
    void _omit;
    const md = summaryToMarkdown(summarizeRecording({ meta: old, rows: [], diags: [] }));
    expect(md).toContain('- 입력 방식: –');
    expect(md).toContain('| SYNC rtt | 0 | – | – | – |');
    expect(md).toContain('채점 delta 평균: –ms');
    expect(md).not.toContain('| 세션 |');
  });

  it('코칭 기준 비교: coachEval을 세션별·방식별·tag별로 세고 Markdown에 나란히 보인다', () => {
    const start = (title: string): DiagEvent => ({
      type: 'session', phase: 'start', mode: 'RHYTHM', songId: title, title, chartVersionId: 1,
      windows: { perfectMs: 25, goodMs: 150 } as never, audioOffsetMs: 0, kickOffsetMs: 0, noteCount: 3, t: 0,
    });
    const e = (basis: 'fixed' | 'window', tag: string): DiagEvent => ({
      type: 'coachEval', basis, active: basis === 'fixed', tag, tMs: 1000, t: 0,
    });
    const s = summarizeRecording({
      meta,
      rows: [],
      diags: [e('fixed', 'LIVE_EARLY'), start('곡 A'), e('fixed', 'LIVE_LATE'), e('fixed', 'LIVE_LATE'), e('window', 'LIVE_UNSTEADY'), start('곡 B')],
    });
    expect(s.sessions[0].coach.fixed).toEqual({ total: 2, byTag: { LIVE_LATE: 2 } });
    expect(s.sessions[0].coach.window).toEqual({ total: 1, byTag: { LIVE_UNSTEADY: 1 } });
    expect(s.sessions[1].coach.fixed.total).toBe(0);
    const md = summaryToMarkdown(s);
    expect(md).toContain('| 문구 수 | 2 | 1 |');
    expect(md).toContain('| LIVE_LATE | 2 | 0 |');
    expect(md).toContain('| LIVE_UNSTEADY | 0 | 1 |');
    expect(md).not.toContain('### 곡 B');
  });
});

describe('녹화 요약의 자동 보정 멈춤 줄', () => {
  const halt = (t: number, stickId: 0 | 1): DiagEvent => ({ type: 'yawHalt', t, stickId, flips: 2, medianDeg: 7, appliedDeg: -3 });

  it('yawHalt 줄 수를 손별로 세고 Markdown에 한 줄을 낸다', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [halt(1, 0), halt(2, 1), halt(3, 1)] });
    expect(s.yawHalts).toEqual([1, 2]);
    expect(summaryToMarkdown(s)).toContain('- 자동 보정 멈춤: 왼손 1번 · 오른손 2번');
  });

  it('줄이 없는 녹화는 [0, 0]이고 Markdown에 줄을 내지 않는다', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [] });
    expect(s.yawHalts).toEqual([0, 0]);
    expect(summaryToMarkdown(s)).not.toContain('자동 보정 멈춤');
  });
});

describe('녹화 요약의 audio 줄', () => {
  // kickOffsetMs를 넘기지 않으면 옛 녹화처럼 필드가 없는 줄이 된다
  const audio = (t: number, audioOffsetMs: number, outputLatencyMs: number | null, kickOffsetMs?: number): DiagEvent =>
    ({
      type: 'audio', t, audioOffsetMs, ...(kickOffsetMs === undefined ? {} : { kickOffsetMs }),
      baseLatencyMs: 10, outputLatencyMs, sampleRate: 48000, measured: null,
    }) as DiagEvent;

  it('마지막 audio 줄의 판정 타이밍 보정·지연을 싣고 Markdown에 한 줄로 낸다', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [audio(1, 0, 40), audio(2, -65, 45.25)] });
    expect(s.audio).toEqual({ audioOffsetMs: -65, kickOffsetMs: -65, baseLatencyMs: 10, outputLatencyMs: 45.25 });
    expect(summaryToMarkdown(s)).toContain('- 오디오: 판정 타이밍 보정 -65.0ms · base 10.0ms · output 45.3ms');
  });

  it('킥 값이 스틱 값과 다르면 Markdown에 둘 다 보인다', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [audio(1, -65, 45.25, -40)] });
    expect(s.audio).toMatchObject({ audioOffsetMs: -65, kickOffsetMs: -40 });
    expect(summaryToMarkdown(s)).toContain('- 오디오: 판정 타이밍 보정 스틱 -65.0ms · 킥 -40.0ms · base 10.0ms · output 45.3ms');
  });

  it('킥 값이 스틱 값과 같으면 옛 출력과 똑같다', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [audio(1, -65, 45.25, -65)] });
    expect(summaryToMarkdown(s)).toContain('- 오디오: 판정 타이밍 보정 -65.0ms · base 10.0ms · output 45.3ms');
  });

  it('세션 표: 옛 녹화(킥 값 없음)는 오프셋 한 칸 그대로, 값이 다르면 둘 다', () => {
    const start = (title: string, kick?: number): DiagEvent =>
      ({
        type: 'session', phase: 'start', mode: 'RHYTHM', songId: title, title, chartVersionId: 1,
        windows: { perfectMs: 25, goodMs: 60 }, audioOffsetMs: -65, ...(kick === undefined ? {} : { kickOffsetMs: kick }),
        noteCount: 3, t: 0,
      }) as DiagEvent;
    const md = summaryToMarkdown(summarizeRecording({ meta, rows: [], diags: [start('옛 곡'), start('새 곡', -40)] }));
    expect(md).toContain('| 옛 곡 | RHYTHM | -65.0 | 0 |');
    expect(md).toContain('| 새 곡 | RHYTHM | 스틱 -65.0ms · 킥 -40.0ms | 0 |');
  });

  it('audio 줄이 없으면 null이고 Markdown은 –', () => {
    const s = summarizeRecording({ meta, rows: [], diags: [] });
    expect(s.audio).toBeNull();
    expect(summaryToMarkdown(s)).toContain('- 오디오: –');
  });
});

describe('녹화 탭 숨김 요약 (PLAY-006)', () => {
  const row = (t: number): RecordedRow => ({ t, dir: 'in', transport: 'mock', stick: 0, hex: '', decoded: { kind: 'pose' } });

  it('숨김 횟수와 합계를 세고 마크다운에 한 줄을 넣는다', () => {
    const s = summarizeRecording({
      meta,
      rows: [row(0), row(60_000)],
      diags: [],
      vis: [
        { t: 10_000, hidden: true },
        { t: 14_000, hidden: false },
        { t: 20_000, hidden: true },
        { t: 22_000, hidden: false },
      ],
    });
    expect(s.hidden).toEqual({ count: 2, totalMs: 6000 });
    expect(summaryToMarkdown(s)).toContain('- 녹화 탭 숨김: 2번, 합계 6초');
  });

  it('끝까지 숨겨진 채면 마지막 줄 시각까지 합산한다', () => {
    const s = summarizeRecording({ meta, rows: [row(0), row(30_000)], diags: [], vis: [{ t: 10_000, hidden: true }] });
    expect(s.hidden).toEqual({ count: 1, totalMs: 20_000 });
  });

  it('vis 줄이 없으면 null이고 마크다운에도 줄이 없다', () => {
    const s = summarizeRecording({ meta, rows: [row(0)], diags: [] });
    expect(s.hidden).toBeNull();
    expect(summaryToMarkdown(s)).not.toContain('녹화 탭 숨김');
  });
});
