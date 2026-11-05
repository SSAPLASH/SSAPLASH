// 합성 플레이로 설계의 인수 조건을 확인한다: 경향이 있으면 뜨고, 없으면 거의 안 뜨고, 간격·상한을 지킨다.
import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/pads';
import { LIVE_COACH_CONFIG } from './config';
import { LIVE_OFF_TAG, LIVE_RECOVERED_TAG, LiveCoach, type CoachMessage } from './LiveCoach';
import type { JudgedNote } from './window';

/** 재현 가능한 난수(mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE_GAP_MS = 500;

function hit(i: number, deltaMs: number, over: Partial<JudgedNote> = {}): JudgedNote {
  const noteTimeMs = 4_000 + i * NOTE_GAP_MS;
  return {
    songTimeMs: noteTimeMs + deltaMs,
    noteTimeMs,
    judgement: Math.abs(deltaMs) <= 25 ? 'PERFECT' : 'GOOD',
    deltaMs,
    pad: 'SNARE',
    stickId: (i % 2) as 0 | 1,
    velocity: 90,
    ...over,
  };
}
function miss(i: number, pad: PadId = 'SNARE'): JudgedNote {
  const noteTimeMs = 4_000 + i * NOTE_GAP_MS;
  return { songTimeMs: noteTimeMs + 60, noteTimeMs, judgement: 'MISS', deltaMs: null, pad, stickId: null, velocity: null };
}

/** 노트열을 차례로 넣고 뜬 문구를 모은다 */
function play(coach: LiveCoach, notes: JudgedNote[]): CoachMessage[] {
  const out: CoachMessage[] = [];
  for (const n of notes) {
    const m = coach.push(n);
    if (m) out.push(m);
  }
  return out;
}

describe('LiveCoach 경향이 있는 플레이', () => {
  it('계속 +25ms 늦으면 8번째 판정에서 LIVE_LATE가 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const notes = Array.from({ length: 12 }, (_, i) => hit(i, 25));
    const out: (CoachMessage | null)[] = notes.map((n) => coach.push(n));
    expect(out.slice(0, 7).every((m) => m === null)).toBe(true);
    expect(out[7]?.tag).toBe('LIVE_LATE');
    expect(out[7]?.text).toBe('계속 조금 늦어요. 살짝 앞서서 쳐 보세요.');
    expect(out[7]?.displayMs).toBe(3_000);
    expect(out[7]?.target).toBeNull();
  });

  it('계속 -25ms 빠르면 LIVE_EARLY가 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const out = play(coach, Array.from({ length: 12 }, (_, i) => hit(i, -25)));
    expect(out[0].tag).toBe('LIVE_EARLY');
  });

  it('왼손만 약하면 LIVE_HAND_WEAK(왼손)이 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const notes = Array.from({ length: 16 }, (_, i) => hit(i, 0, { velocity: i % 2 === 0 ? 50 : 100 }));
    const out = play(coach, notes);
    expect(out.map((m) => m.tag)).toContain('LIVE_HAND_WEAK');
    expect(out.find((m) => m.tag === 'LIVE_HAND_WEAK')?.text.startsWith('왼손')).toBe(true);
    expect(out.find((m) => m.tag === 'LIVE_HAND_WEAK')?.target).toEqual({ kind: 'hand', hand: 0 });
  });

  it('잘 치다가 3번 연속 놓치면 LIVE_MISS_STREAK가 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const good = Array.from({ length: 8 }, (_, i) => hit(i, 0));
    expect(play(coach, good)).toEqual([]);
    expect(coach.push(miss(8))).toBeNull();
    expect(coach.push(miss(9))).toBeNull();
    expect(coach.push(miss(10))?.tag).toBe('LIVE_MISS_STREAK');
  });

  it('SNARE만 +45ms 늦으면 그 패드로 LIVE_PAD_LATE가 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const notes = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? hit(i, 45, { pad: 'SNARE' }) : hit(i, 0, { pad: 'HIHAT' })));
    const out = play(coach, notes);
    const pad = out.find((m) => m.tag === 'LIVE_PAD_LATE');
    expect(pad?.text).toBe('스네어에서 유독 늦어요.');
    expect(pad?.target).toEqual({ kind: 'pad', pad: 'SNARE' });
  });

  it('goodMs가 30·60·150이어도 판정 폭의 절반만큼 늦으면 모두 LIVE_LATE가 뜬다', () => {
    for (const g of [30, 60, 150]) {
      const coach = new LiveCoach({ goodMs: g });
      const out = play(coach, Array.from({ length: 10 }, (_, i) => hit(i, g / 2)));
      expect(out[0]?.tag, `goodMs=${g}`).toBe('LIVE_LATE');
    }
  });

  it('같은 지연(+25ms)이어도 goodMs 150이면 판정 폭 대비 작아서 뜨지 않는다', () => {
    const coach = new LiveCoach({ goodMs: 150 });
    expect(play(coach, Array.from({ length: 16 }, (_, i) => hit(i, 25)))).toEqual([]);
  });
});

describe('LiveCoach 경향이 없는 플레이', () => {
  it('deltaMs ±10ms 무작위, 세기 동일, 놓침 3%인 200노트 100플레이에서 문구가 평균 0.5개 이하다', () => {
    let total = 0;
    const pads: PadId[] = ['SNARE', 'HIHAT', 'KICK', 'MID_TOM'];
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const coach = new LiveCoach({ goodMs: 60 });
      for (let i = 0; i < 200; i++) {
        const pad = pads[Math.floor(r() * pads.length)];
        const n = r() < 0.03 ? miss(i, pad) : hit(i, (r() * 2 - 1) * 10, { pad, velocity: 88 + Math.floor(r() * 5) });
        if (coach.push(n)) total++;
      }
    }
    expect(total / 100).toBeLessThanOrEqual(0.5);
  });
});

describe('LiveCoach 표시 정책', () => {
  it('엉망인 플레이에서도 문구 사이 8초, 플레이당 10개를 지킨다', () => {
    const r = rng(7);
    const coach = new LiveCoach({ goodMs: 60 });
    const out: CoachMessage[] = [];
    for (let i = 0; i < 600; i++) {
      const n = r() < 0.3 ? miss(i) : hit(i, (r() * 2 - 1) * 90, { stickId: r() < 0.5 ? 0 : 1, velocity: 20 + Math.floor(r() * 100) });
      const m = coach.push(n);
      if (m) out.push(m);
    }
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(LIVE_COACH_CONFIG.policy.maxPerPlay);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].tMs - out[i - 1].tMs).toBeGreaterThanOrEqual(LIVE_COACH_CONFIG.policy.minGapMs);
    }
  });

  it('늦다가 정시로 돌아오면 LIVE_RECOVERED만 로그에 남고 문구는 띄우지 않는다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const late = play(coach, Array.from({ length: 10 }, (_, i) => hit(i, 25)));
    expect(late.map((m) => m.tag)).toEqual(['LIVE_LATE']);
    const back = play(coach, Array.from({ length: 12 }, (_, i) => hit(10 + i, 0)));
    expect(back).toEqual([]);
    const tags = coach.events().map((e) => e.tag);
    expect(tags).toEqual(['LIVE_LATE', LIVE_RECOVERED_TAG]);
    expect(coach.events()[1].text).toBe('경향 해소: LIVE_LATE');
  });
});

describe('LiveCoach 로그와 설정', () => {
  it('events()는 BE 검증 형식(tMs 유한 수, tag ≤ 64자, text ≤ 2048자)이다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    play(coach, Array.from({ length: 12 }, (_, i) => hit(i, 25)));
    expect(coach.events().length).toBeGreaterThan(0);
    for (const e of coach.events()) {
      expect(Number.isFinite(e.tMs)).toBe(true);
      expect(e.tag.length).toBeGreaterThan(0);
      expect(e.tag.length).toBeLessThanOrEqual(64);
      expect(e.text.length).toBeGreaterThan(0);
      expect(e.text.length).toBeLessThanOrEqual(2048);
    }
  });

  it('꺼진 코칭은 문구를 띄우지 않고 LIVE_OFF 한 건만 남긴다', () => {
    const coach = new LiveCoach({ goodMs: 60, enabled: false });
    expect(play(coach, Array.from({ length: 12 }, (_, i) => hit(i, 40)))).toEqual([]);
    expect(coach.events()).toEqual([{ tMs: 0, tag: LIVE_OFF_TAG, text: '코칭 꺼짐' }]);
  });

  it('reset하면 상태와 로그를 비우고 같은 플레이에서 다시 문구가 뜬다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    const notes = Array.from({ length: 10 }, (_, i) => hit(i, 25));
    expect(play(coach, notes)).toHaveLength(1);
    coach.reset();
    expect(coach.events()).toEqual([]);
    expect(play(coach, notes)).toHaveLength(1);
  });

  it('잘못된 입력(NaN 시각, 손 번호 2)은 던지지 않고 무시하며 다음 판정부터 정상 동작한다', () => {
    const coach = new LiveCoach({ goodMs: 60 });
    expect(coach.push({ ...hit(0, 25), songTimeMs: Number.NaN })).toBeNull();
    expect(() => coach.push({ ...hit(1, 25), stickId: 2 as unknown as 0 })).not.toThrow();
    const out = play(coach, Array.from({ length: 12 }, (_, i) => hit(2 + i, 25)));
    expect(out[0]?.tag).toBe('LIVE_LATE');
  });
});

describe('LiveCoach 계산 시간', () => {
  it('push 한 번은 중앙값 0.2ms 이하, 99백분위 2ms 이하다 (12개 창)', () => {
    const r = rng(3);
    const coach = new LiveCoach({ goodMs: 60 });
    const warm = (i: number) => hit(i, (r() * 2 - 1) * 20, { pad: (['SNARE', 'HIHAT', 'KICK'] as const)[i % 3] });
    for (let i = 0; i < 500; i++) coach.push(warm(i));
    const times: number[] = [];
    for (let i = 0; i < 5_000; i++) {
      const n = warm(i);
      const t0 = performance.now();
      coach.push(n);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThanOrEqual(0.2);
    expect(times[Math.floor(times.length * 0.99)]).toBeLessThanOrEqual(2);
  });
});
