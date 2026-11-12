import { describe, expect, it } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { DiagEvent } from '@/engine/diagTap';
import { timingReport } from './timingReport';

const windows = { perfectMs: 25, goodMs: 60 };

const sessionStart = (t: number, title = '곡A'): DiagEvent => ({
  type: 'session',
  phase: 'start',
  mode: 'RHYTHM',
  songId: 's1',
  title,
  chartVersionId: 7,
  windows,
  audioOffsetMs: 0, kickOffsetMs: 0,
  noteCount: 100,
  t,
});
const sessionEnd = (t: number): DiagEvent => ({ ...(sessionStart(t) as Extract<DiagEvent, { type: 'session' }>), phase: 'end' });

const resolved = (id: number, source: string, stickId: 0 | 1 | null = null): DiagEvent =>
  ({
    type: 'resolved',
    hit: { id, source, stickId, pad: 'SNARE', velocity: 100, tHit: 0, tRecv: 0, tResolved: 0 } as unknown as ResolvedHit,
    t: 0,
  }) as DiagEvent;

const judged = (id: number, songTimeMs: number, deltaMs: number | null): DiagEvent => ({
  type: 'judged',
  hitId: id,
  judgement: deltaMs === null ? null : Math.abs(deltaMs) > 60 ? 'MISS' : 'PERFECT',
  noteIndex: 0,
  notePad: 'SNARE',
  hitPad: 'SNARE',
  deltaMs,
  songTimeMs,
  t: 0,
});

/** 1초 간격 n개. delta = base + slope(ms/분) × 분 */
function ramp(n: number, base: number, slopePerMin: number, source = 'keyboard', idStart = 1): DiagEvent[] {
  const out: DiagEvent[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 1000;
    out.push(resolved(idStart + i, source, source === 'keyboard' ? null : 0));
    out.push(judged(idStart + i, t, base + (slopePerMin * t) / 60_000));
  }
  return out;
}

describe('timingReport', () => {
  it('기울기 +5ms/분을 5±0.5로 계산한다', () => {
    const r = timingReport([sessionStart(1000), ...ramp(180, 0, 5), sessionEnd(200_000)]);
    expect(r).toHaveLength(1);
    expect(r[0].slopeMsPerMin).toBeGreaterThan(4.5);
    expect(r[0].slopeMsPerMin).toBeLessThan(5.5);
    expect(r[0].chartVersionId).toBe(7);
    expect(r[0].startedAt).toBe(1000);
    expect(r[0].thirds[2]! > r[0].thirds[0]!).toBe(true);
  });

  it('입력 출처별로 나누고 판정 창 밖 값은 건수만 센다', () => {
    const evs = [
      sessionStart(0),
      ...ramp(25, 10, 0, 'keyboard', 1),
      ...ramp(25, 30, 0, 'stickX', 100),
      resolved(500, 'keyboard'),
      judged(500, 5000, 200),
    ];
    const [r] = timingReport(evs);
    expect(r.byInput.map((b) => b.input)).toEqual(['keyboard', 'stickX 왼손']);
    expect(r.byInput[0].meanMs).toBeCloseTo(10);
    expect(r.byInput[1].meanMs).toBeCloseTo(30);
    expect(r.outliers).toBe(1);
    expect(r.miss).toBe(1);
    expect(r.judged).toBe(51);
    expect(r.inputs.keyboard).toBe(26);
    expect(r.lowSample).toBe(false);
  });

  it('판정 20개 미만은 표본 부족, 채보 밖 타격은 뺀다', () => {
    const [r] = timingReport([sessionStart(0), ...ramp(10, 0, 0), resolved(99, 'keyboard'), judged(99, 0, null)]);
    expect(r.lowSample).toBe(true);
    expect(r.verdictHint).toBe('표본 부족');
    expect(r.judged).toBe(10);
  });

  it('accDrift 시작·끝·기울기와 힌트(채보 BPM vs 반주 시계)', () => {
    const drift = (sec: number, ms: number): DiagEvent => ({ type: 'accDrift', songTimeMs: sec * 1000, audioPosMs: sec * 1000 + ms, driftMs: ms, t: 0 });
    const flat = timingReport([sessionStart(0), ...ramp(60, 0, 5), drift(0, 0), drift(60, 0.1), drift(120, 0)])[0];
    expect(flat.accDrift?.n).toBe(3);
    expect(flat.verdictHint).toContain('채보 BPM');
    const drifting = timingReport([sessionStart(0), ...ramp(60, 0, 5), drift(0, 0), drift(60, 6), drift(120, 12)])[0];
    expect(drifting.accDrift?.startMs).toBe(0);
    expect(drifting.accDrift?.endMs).toBe(12);
    expect(drifting.accDrift?.slopeMsPerMin).toBeCloseTo(6, 1);
    expect(drifting.verdictHint).toContain('반주 시계');
    const none = timingReport([sessionStart(0), ...ramp(60, 0, 5)])[0];
    expect(none.accDrift).toBeNull();
  });

  it('오차가 작으면 해결 힌트, 세션은 start마다 나뉜다', () => {
    const r = timingReport([sessionStart(0, 'A'), ...ramp(30, 3, 0), sessionStart(9000, 'B'), ...ramp(30, 40, 0, 'keyboard', 1000)]);
    expect(r.map((x) => x.title)).toEqual(['A', 'B']);
    expect(r[0].verdictHint).toContain('오차 작음');
    expect(r[1].verdictHint).toContain('채보 원점');
  });
});
