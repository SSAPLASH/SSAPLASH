import { describe, expect, it } from 'vitest';
import { createCoachShadow, type CoachEvalBody } from './shadowCoach';
import type { JudgedNote } from '@/coach/live/window';

function late(i: number, deltaMs: number): JudgedNote {
  const noteTimeMs = 4_000 + i * 500;
  return { songTimeMs: noteTimeMs + deltaMs, noteTimeMs, judgement: 'GOOD', deltaMs, pad: 'SNARE', stickId: (i % 2) as 0 | 1, velocity: 90 };
}

function run(goodMs: number, deltaMs: number, activeBasis: 'fixed' | 'window' = 'fixed'): CoachEvalBody[] {
  const out: CoachEvalBody[] = [];
  const shadow = createCoachShadow({ goodMs, activeBasis, publish: (b) => out.push(b) });
  for (let i = 0; i < 20; i++) shadow.push(late(i, deltaMs));
  return out;
}

describe('createCoachShadow', () => {
  it('판정 폭 150에서 평균 +25ms 늦음: fixed만 LIVE_LATE를 낸다', () => {
    const out = run(150, 25);
    expect(out.filter((e) => e.basis === 'fixed').map((e) => e.tag)).toContain('LIVE_LATE');
    expect(out.filter((e) => e.basis === 'window')).toEqual([]);
  });

  it('판정 폭 60에서는 두 방식이 같은 문구를 낸다', () => {
    const out = run(60, 25);
    const tags = (b: string) => out.filter((e) => e.basis === b).map((e) => `${e.tag}@${e.tMs}`);
    expect(tags('fixed').length).toBeGreaterThan(0);
    expect(tags('window')).toEqual(tags('fixed'));
  });

  it('active는 화면 방식에만 true', () => {
    const out = run(60, 25, 'window');
    expect(out.every((e) => e.active === (e.basis === 'window'))).toBe(true);
  });

  it('reset 뒤에는 처음부터 다시 평가한다', () => {
    const out: CoachEvalBody[] = [];
    const shadow = createCoachShadow({ goodMs: 150, activeBasis: 'fixed', publish: (b) => out.push(b) });
    for (let i = 0; i < 20; i++) shadow.push(late(i, 25));
    const n = out.length;
    shadow.reset();
    for (let i = 0; i < 20; i++) shadow.push(late(i, 25));
    expect(out.length).toBe(n * 2);
  });
});
