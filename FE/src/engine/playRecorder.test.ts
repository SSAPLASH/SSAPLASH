import { describe, expect, it } from 'vitest';
import type { Chart } from '@/domain/chart';
import type { ResolvedHit } from '@/domain/events';
import { RhythmSession } from './RhythmSession';
import { PlayRecorder } from './playRecorder';

const chart: Chart = {
  songId: 's',
  title: 't',
  difficulty: 'EASY',
  bpm: 120,
  offsetMs: 0,
  beatsPerBar: 4,
  source: 'BUILTIN',
  durationMs: 2000,
  notes: [
    { timeMs: 0, pad: 'SNARE' },
    { timeMs: 500, pad: 'SNARE' },
    { timeMs: 1000, pad: 'KICK' },
  ],
};

const hitAt = (id: number, tHit: number, pad: ResolvedHit['pad']): ResolvedHit =>
  ({ id, stickId: 0, pad, velocity: 90, tHit, tRecv: tHit, tResolved: tHit }) as ResolvedHit;

function setup() {
  const ss = new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 0, audioOffsetMs: 10 });
  const rec = new PlayRecorder();
  ss.onJudgement((e) => rec.judgement(e));
  ss.start(1000); // 곡 0ms = performance.now 1000
  return { ss, rec };
}

describe('PlayRecorder', () => {
  it('타격과 MISS를 처리 순서대로 번호 매긴다', () => {
    const { ss, rec } = setup();
    const h0 = hitAt(1, 1015, 'SNARE'); // t = 1015 - 10 - 1000 = 5 → PERFECT
    rec.hit(h0, ss.handleHit(h0), ss);
    ss.tick(1000 + 600); // 500ms 노트 지나감 → MISS
    const h1 = hitAt(2, 1700, 'HIHAT'); // 채보 밖
    rec.hit(h1, ss.handleHit(h1), ss);

    expect(rec.hits.map((h) => h.seq)).toEqual([0, 2]);
    expect(rec.missSeqs.get(1)).toBe(1);
    expect(rec.hits[0]).toMatchObject({ judgement: 'PERFECT', matchedNoteIndex: 0, deltaMs: 5, tSongMs: 5 });
    expect(rec.hits[1].tSongMs).toBe(690);
    expect(rec.hits[1].judgement).toBeUndefined();
  });

  it('reset하면 순번과 기록을 비운다', () => {
    const { ss, rec } = setup();
    const h = hitAt(1, 1010, 'SNARE');
    rec.hit(h, ss.handleHit(h), ss);
    rec.reset();
    expect(rec.hits).toEqual([]);
    expect(rec.missSeqs.size).toBe(0);
    const h2 = hitAt(2, 1510, 'SNARE');
    expect(rec.hit(h2, null, ss).seq).toBe(0);
  });
});
