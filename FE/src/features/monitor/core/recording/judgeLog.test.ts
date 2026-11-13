import { describe, expect, it } from 'vitest';
import type { DiagBody, DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import { findHitRow, JudgeLog, meanStd } from './judgeLog';
import type { LogRow } from './packetLog';

let clock = 0;
const ev = (b: DiagBody): DiagEvent => ({ ...b, t: ++clock }) as DiagEvent;

const hit = (over: Partial<ResolvedHit> = {}): ResolvedHit => ({
  id: 1,
  stickId: 0,
  pad: 'SNARE',
  velocity: 80,
  tHit: 1000,
  tRecv: 1000,
  tResolved: 1002,
  source: 'ble',
  pose: { pitch: 0, yaw: 0 },
  peakAccel: 6,
  judgedBy: 'stick',
  ...over,
});

/** 수신 HIT 패킷 행. decoded는 필요한 필드만 */
const hitRow = (t: number, seq: number, pad: string | null, stick: 0 | 1 | null = 0, velocity = 90): LogRow =>
  ({
    id: Math.round(t),
    t,
    dir: 'in',
    transport: 'ble',
    stick,
    bytes: new Uint8Array(0),
    decoded: { kind: 'hit', seq, pad, velocity },
    outType: null,
    tBrowser: null,
    futureMs: null,
    log: null,
  }) as unknown as LogRow;

const windows = { perfectMs: 25, goodMs: 60 };
type SessionBody = Extract<DiagBody, { type: 'session' }>;
const start = (noteCount = 10): SessionBody => ({
  type: 'session',
  phase: 'start',
  mode: 'RHYTHM',
  songId: 's',
  title: '곡',
  chartVersionId: 3,
  windows,
  audioOffsetMs: 0, kickOffsetMs: 0,
  noteCount,
});
const judged = (over: Partial<Extract<DiagBody, { type: 'judged' }>> = {}): DiagBody => ({
  type: 'judged',
  hitId: 1,
  judgement: 'PERFECT',
  noteIndex: 0,
  notePad: 'SNARE',
  hitPad: 'SNARE',
  deltaMs: 5,
  songTimeMs: 1000,
  ...over,
});

describe('meanStd', () => {
  it('빈 배열은 null', () => expect(meanStd([])).toEqual({ mean: null, std: null }));
  it('평균과 모표준편차', () => {
    const r = meanStd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(r.mean).toBe(5);
    expect(r.std).toBe(2);
  });
});

describe('JudgeLog 채점 집계', () => {
  it('세션이 없으면 비어 있다', () => {
    const s = new JudgeLog().stats([]).score;
    expect(s.session).toBeNull();
    expect(s.delta.mean).toBeNull();
    expect(s.recent).toEqual([]);
  });

  it('판정 카운트·점수·콤보를 judged·missed에서 파생한다', () => {
    const log = new JudgeLog();
    log.push(ev(start(4)));
    log.push(ev(judged({ hitId: 1, judgement: 'PERFECT', noteIndex: 0 })));
    log.push(ev(judged({ hitId: 2, judgement: 'GOOD', noteIndex: 1, deltaMs: 40 })));
    log.push(ev({ type: 'missed', noteIndex: 2, pad: 'KICK', songTimeMs: 3000 }));
    log.push(ev(judged({ hitId: 3, judgement: 'PERFECT', noteIndex: 3 })));
    const s = log.stats([]).score;
    expect(s.counts).toEqual({ PERFECT: 2, GOOD: 1, MISS: 1 });
    expect(s.score).toBe(280);
    expect(s.maxScore).toBe(400);
    expect(s.combo).toBe(1);
    expect(s.maxCombo).toBe(2);
    expect(s.judgedCount).toBe(4);
  });

  it('stray는 패드가 있을 때만 센다(RhythmSession과 같은 규칙)', () => {
    const log = new JudgeLog();
    log.push(ev(start()));
    log.push(ev(judged({ hitId: 1, judgement: null, noteIndex: null, notePad: null, deltaMs: null })));
    log.push(ev(judged({ hitId: 2, judgement: null, noteIndex: null, notePad: null, hitPad: null, deltaMs: null })));
    const s = log.stats([]).score;
    expect(s.stray).toBe(1);
    expect(s.recent.map((r) => r.kind)).toEqual(['stray', 'stray']);
    expect(s.counts.PERFECT).toBe(0);
  });

  it('delta 평균·표준편차는 최근 50판정만 본다', () => {
    const log = new JudgeLog();
    log.push(ev(start(100)));
    for (let i = 0; i < 60; i++) log.push(ev(judged({ hitId: i, noteIndex: i, deltaMs: i < 10 ? 100 : 10 })));
    const d = log.stats([]).score.delta;
    expect(d.n).toBe(50);
    expect(d.mean).toBe(10);
    expect(d.std).toBe(0);
  });

  it('최근 목록은 최신이 앞이고 judged·missed 종류가 구분된다', () => {
    const log = new JudgeLog();
    log.push(ev(start()));
    log.push(ev(judged({ hitId: 1 })));
    log.push(ev({ type: 'missed', noteIndex: 1, pad: 'KICK', songTimeMs: 2000 }));
    const r = log.stats([]).score.recent;
    expect(r[0]).toMatchObject({ kind: 'missed', notePad: 'KICK', hitPad: null, noteIndex: 1 });
    expect(r[1]).toMatchObject({ kind: 'judged', notePad: 'SNARE', hitPad: 'SNARE' });
  });

  it('판정 행에 resolved의 seq·스틱이 붙는다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 7, seq: 42, stickId: 1 }) }));
    log.push(ev(start()));
    log.push(ev(judged({ hitId: 7 })));
    expect(log.stats([]).score.recent[0]).toMatchObject({ seq: 42, stick: 1 });
  });

  it('세션 정보에 킥 값을 싣고, 옛 녹화(필드 없음)는 스틱 값과 같다고 본다', () => {
    const log = new JudgeLog();
    log.push(ev({ ...start(2), audioOffsetMs: -65, kickOffsetMs: -40 }));
    expect(log.stats([]).score.session).toMatchObject({ audioOffsetMs: -65, kickOffsetMs: -40 });
    const old = new JudgeLog();
    const { kickOffsetMs: _drop, ...oldBody } = start(2);
    old.push(ev({ ...oldBody, audioOffsetMs: -65 } as unknown as DiagBody));
    expect(old.stats([]).score.session).toMatchObject({ audioOffsetMs: -65, kickOffsetMs: -65 });
  });

  it('세션 상태: 일시정지·재개·종료 후 값이 고정되고 요약이 우선한다', () => {
    const log = new JudgeLog();
    log.push(ev(start(2)));
    log.push(ev(judged()));
    log.push(ev({ ...start(2), phase: 'pause' }));
    expect(log.stats([]).score.session?.status).toBe('paused');
    log.push(ev({ ...start(2), phase: 'resume' }));
    expect(log.stats([]).score.session?.status).toBe('running');
    log.push(
      ev({
        ...start(2),
        phase: 'end',
        reason: 'finished',
        summary: {
          score: 160,
          maxScore: 200,
          combo: 2,
          maxCombo: 2,
          counts: { PERFECT: 1, GOOD: 1, MISS: 0 },
          strayHits: 3,
          judgedCount: 2,
        },
      }),
    );
    const s = log.stats([]).score;
    expect(s.session).toMatchObject({ status: 'ended', endReason: 'finished' });
    expect(s.stray).toBe(3);
    expect(s.counts.GOOD).toBe(1);
    expect(s.maxCombo).toBe(2);
  });

  it('다시 시작하면 집계가 초기화된다', () => {
    const log = new JudgeLog();
    log.push(ev(start()));
    log.push(ev(judged()));
    log.push(ev(start()));
    const s = log.stats([]).score;
    expect(s.judgedCount).toBe(0);
    expect(s.recent).toEqual([]);
  });

  it('노트 배열을 보관한다', () => {
    const log = new JudgeLog();
    log.push(ev(start()));
    log.push(ev({ type: 'notes', songId: 's', notes: [{ timeMs: 100, pad: 'SNARE' }] }));
    expect(log.stats([]).score.notes).toHaveLength(1);
  });
});

describe('JudgeLog 판정(④) 집계', () => {
  it('패드 판정 출처 비율을 센다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, judgedBy: 'stick' }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 2, judgedBy: 'stick' }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 3, judgedBy: 'pose' }) }));
    const r = log.stats([]).resolve;
    expect(r.judgedBy).toEqual({ stick: 2, pose: 1, chart: 0, key: 0 });
    expect(r.judgedByN).toBe(3);
  });

  it('seq로 찾은 HIT 패킷의 펌웨어 pad와 FE 최종 pad가 다르면 불일치', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, seq: 10, pad: 'SNARE' }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 2, seq: 11, pad: 'SNARE' }) }));
    const rows = [hitRow(990, 10, 'SNARE'), hitRow(995, 11, 'SMALL_TOM')];
    const m = log.stats(rows).resolve.padMismatch;
    expect(m).toEqual({ compared: 2, mismatched: 1, pct: 50 });
  });

  it('seq가 없거나 패킷을 못 찾은 타격은 비교에서 제외한다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, source: 'keyboard' }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 2, seq: 5 }) }));
    const m = log.stats([]).resolve.padMismatch;
    expect(m).toEqual({ compared: 0, mismatched: 0, pct: null });
  });

  it('펌웨어 pad 없음(null)과 FE pad가 다르면 불일치', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, seq: 1, pad: 'SNARE', judgedBy: 'pose' }) }));
    expect(log.stats([hitRow(1000, 1, null)]).resolve.padMismatch.mismatched).toBe(1);
  });

  it('바운더리 안 비율·거리 중앙값·pad null 건수', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, inside: true, distanceDeg: 4 }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 2, inside: true, distanceDeg: 8 }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 3, inside: false, distanceDeg: 20 }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 4, pad: null, source: 'keyboard' }) }));
    const r = log.stats([]).resolve;
    expect(r.inside.n).toBe(3);
    expect(r.inside.pct).toBeCloseTo(66.67, 1);
    expect(r.inside.distanceMedian).toBe(8);
    expect(r.padNull).toEqual({ n: 1, window: 4 });
  });

  it('최근 50건만 본다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 0, pad: null }) }));
    for (let i = 1; i <= 50; i++) log.push(ev({ type: 'resolved', hit: hit({ id: i }) }));
    expect(log.stats([]).resolve.padNull.n).toBe(0);
  });

  it('링은 상한을 넘으면 오래된 것부터 버린다', () => {
    const log = new JudgeLog(3);
    for (let i = 0; i < 5; i++) log.push(ev({ type: 'resolved', hit: hit({ id: i }) }));
    expect(log.events()).toHaveLength(3);
  });

  it('세기 입력(스틱)·출력(FE) 쌍을 만든다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, seq: 3, velocity: 70 }) }));
    const p = log.velocityPairs([hitRow(999, 3, 'SNARE', 0, 100)]);
    expect(p).toEqual([{ stick: 0, pad: 'SNARE', seq: 3, stickVelocity: 100, feVelocity: 70 }]);
  });
});

describe('findHitRow', () => {
  it('seq가 같아도 수신 시각이 2초 넘게 차이 나면 짝으로 보지 않는다(u8 순환)', () => {
    const h = hit({ seq: 9, tRecv: 10_000 });
    expect(findHitRow([hitRow(5000, 9, 'SNARE')], h)).toBeNull();
    expect(findHitRow([hitRow(9500, 9, 'SNARE')], h)).not.toBeNull();
  });

  it('다른 스틱의 같은 seq는 건너뛴다', () => {
    const h = hit({ seq: 9, tRecv: 1000, stickId: 1 });
    expect(findHitRow([hitRow(1000, 9, 'SNARE', 0)], h)).toBeNull();
  });

  it('후보가 둘이면 수신 시각이 더 가까운 쪽', () => {
    const h = hit({ seq: 9, tRecv: 1000 });
    const near = hitRow(1001, 9, 'KICK');
    expect(findHitRow([hitRow(300, 9, 'SNARE'), near], h)).toBe(near);
  });
});

describe('JudgeLog 페달(stickId null, PLAY-002)', () => {
  // 인수 조건: 손 없는 타격은 스틱 세기 비교(velocityPairs)에서 제외
  it('velocityPairs는 stickId null 타격을 건너뛴다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, seq: 3, velocity: 70 }) }));
    log.push(ev({ type: 'resolved', hit: hit({ id: 2, seq: 4, velocity: 100, stickId: null, foot: 3, pad: 'KICK' }) }));
    const p = log.velocityPairs([hitRow(999, 3, 'SNARE', 0, 100), hitRow(1000, 4, 'KICK', null, 100)]);
    expect(p).toEqual([{ stick: 0, pad: 'SNARE', seq: 3, stickVelocity: 100, feVelocity: 70 }]);
  });

  it('손 없는 타격이 섞여도 stats가 던지지 않는다', () => {
    const log = new JudgeLog();
    log.push(ev({ type: 'resolved', hit: hit({ id: 1, stickId: null, foot: 3, pad: 'KICK' }) }));
    expect(() => log.stats([])).not.toThrow();
  });
});
