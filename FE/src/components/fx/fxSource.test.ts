import { describe, expect, it } from 'vitest';
import type { JudgementEvent } from '@/engine/RhythmSession';
import { judgedFxEvent, missFxEvent } from './fxSource';

const hit = (pad: Parameters<typeof judgedFxEvent>[0]['pad'], id = 5, velocity = 90) => ({ id, pad, velocity });
const judged = (over: Partial<JudgementEvent> = {}): JudgementEvent => ({ judgement: 'PERFECT', deltaMs: -12, pad: 'SNARE', noteIndex: 3, at: 0, stickId: null, velocity: null, pose: null, ...over });

describe('judgedFxEvent', () => {
  it('판정 중 + 판정 있음 → 판정·deltaMs·noteIndex가 실린 이벤트', () => {
    expect(judgedFxEvent(hit('SNARE'), judged({ judgement: 'GOOD', deltaMs: 41, noteIndex: 9 }), 'game', true)).toEqual({
      seq: 5,
      pad: 'SNARE',
      velocity: 90,
      mode: 'game',
      combo: null,
      judgement: 'GOOD',
      deltaMs: 41,
      noteIndex: 9,
      stray: false,
    });
  });

  it('판정 중인데 맞는 노트 없음 → 헛침(stray, 판정 null)', () => {
    const e = judgedFxEvent(hit('SNARE'), null, 'sheet', true)!;
    expect(e).toMatchObject({ stray: true, judgement: null, deltaMs: null, noteIndex: null, mode: 'sheet' });
  });

  it('판정 중이 아님 → 판정 null, 헛침 아님(자유 연주와 같은 이펙트)', () => {
    const e = judgedFxEvent(hit('SNARE'), null, 'game', false)!;
    expect(e).toMatchObject({ stray: false, judgement: null, deltaMs: null, noteIndex: null });
    // active가 false면 ev가 있어도 판정을 싣지 않는다
    expect(judgedFxEvent(hit('SNARE'), judged(), 'game', false)).toMatchObject({ judgement: null, stray: false });
  });

  it('하이햇 페달은 하이햇 패드로, 패드 없는 타격은 null', () => {
    expect(judgedFxEvent(hit('HIHAT_PEDAL'), null, 'game', true)?.pad).toBe('HIHAT');
    expect(judgedFxEvent(hit(null), null, 'game', true)).toBeNull();
  });
});

describe('missFxEvent', () => {
  it('MISS만 이벤트로, 세기 0·음수 seq·noteIndex 포함', () => {
    const e = missFxEvent(judged({ judgement: 'MISS', deltaMs: null, noteIndex: 4, pad: 'HIHAT_PEDAL' }), 'game')!;
    expect(e).toMatchObject({ judgement: 'MISS', velocity: 0, noteIndex: 4, stray: false, deltaMs: null, pad: 'HIHAT', mode: 'game' });
    expect(e.seq).toBeLessThan(0);
  });
  it('PERFECT·GOOD는 null(이펙트는 onHit 경로에서만 — 두 번 내지 않는다)', () => {
    expect(missFxEvent(judged({ judgement: 'PERFECT' }), 'game')).toBeNull();
    expect(missFxEvent(judged({ judgement: 'GOOD' }), 'sheet')).toBeNull();
  });
});
