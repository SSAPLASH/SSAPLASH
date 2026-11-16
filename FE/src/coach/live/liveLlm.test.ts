// 연주 중 LLM 구간 코칭(설계 COACH-001 연주 중 LLM 코칭 6절 인수 조건)
import { describe, expect, it } from 'vitest';
import { coachCopy } from './copy';
import { LIVE_LLM_TAG, LiveCoach } from './LiveCoach';
import { LlmCoach, type LlmCoachClient, type LlmRecord, type LlmTip } from './llmCoach';
import { assignLlm, parseCoachLiveConfig } from './models/experiment';
import type { HandAnchors, PadAnchor } from '@/domain/kit/calibration/calibration';
import type { PadId } from '@/domain/kit/pads';
import { AIM_CLEAR, MIN_SEGMENT_JUDGED, SegmentTracker, aimFacts, segmentBars, segmentIndexAt, segmentRange, type AimSource, type FinishedSegment, type SegmentChart } from './segment';
import type { JudgedNote } from './window';

// 120BPM 4/4: 한 마디 2000ms, 첫 마디는 0ms
const CHART: SegmentChart = { bpm: 120, offsetMs: 0, beatsPerBar: 4 };
const STEP = 250; // 8분음표

function note(t: number, judgement: JudgedNote['judgement'] = 'GOOD', deltaMs: number | null = 20, pad: JudgedNote['pad'] = 'SNARE'): JudgedNote {
  const songTimeMs = judgement === 'MISS' ? t + 60 : t + (deltaMs ?? 0);
  return { songTimeMs, noteTimeMs: t, judgement, deltaMs: judgement === 'MISS' ? null : deltaMs, pad, stickId: (Math.round(t / STEP) % 2) as 0 | 1, velocity: 90 };
}

describe('마디 구간', () => {
  it('1~4마디, 5~8마디, 9~16마디, 17~32마디, 이후 16마디씩이다', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => segmentBars(i))).toEqual([
      { startBar: 0, bars: 4 },
      { startBar: 4, bars: 4 },
      { startBar: 8, bars: 8 },
      { startBar: 16, bars: 16 },
      { startBar: 32, bars: 16 },
      { startBar: 48, bars: 16 },
    ]);
    expect(segmentRange(CHART, 1)).toMatchObject({ fromBar: 5, toBar: 8, startMs: 8000, endMs: 16000 });
  });

  it('빠르기 변화가 있으면 그 박 시각을 따른다', () => {
    // 4마디 뒤(16박)부터 두 배 빠르기
    const tempo: SegmentChart = { ...CHART, tempoSegments: [{ beat: 0, startMs: 0, bpm: 120 }, { beat: 16, startMs: 8000, bpm: 240 }] };
    expect(segmentRange(tempo, 1)).toMatchObject({ startMs: 8000, endMs: 12000 });
  });

  it('첫 마디 앞(인트로)은 구간에 넣지 않는다', () => {
    expect(segmentIndexAt({ ...CHART, offsetMs: 1000 }, 500)).toBe(-1);
    expect(segmentIndexAt(CHART, 7999)).toBe(0);
    expect(segmentIndexAt(CHART, 8000)).toBe(1);
  });
});

describe('구간 사실', () => {
  it('구간 끝 + 판정 폭이 지나면 사실 하나를 만들고, 식별 정보가 없다', () => {
    const t = new SegmentTracker(CHART, 60, 'stick');
    const done: FinishedSegment[] = [];
    for (let ms = 0; ms < 8000; ms += STEP) done.push(...t.push(note(ms, ms % 1000 === 0 ? 'MISS' : 'GOOD', 30), 1));
    expect(done).toEqual([]);
    done.push(...t.push(note(8100), 2));
    expect(done).toHaveLength(1);
    const f = done[0].facts;
    expect(f.segment).toEqual({ index: 0, fromBar: 1, toBar: 4 });
    expect(f.counts).toEqual({ perfect: 0, good: 24, miss: 8 });
    expect(f.timing.meanDeltaMs).toBe(30);
    expect(f.pads[0]).toMatchObject({ pad: 'SNARE', misses: 8 });
    expect(f.previous).toEqual({ counts: null, lastTip: null });
    expect(done[0].nextDurationMs).toBe(8000);
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/playId|songId|title|hits/);
  });

  it(`판정이 ${MIN_SEGMENT_JUDGED}개 미만인 구간은 건너뛰고, 다음 구간에 직전 판정 수와 직전 문구를 담는다`, () => {
    const t = new SegmentTracker(CHART, 60, 'keyboard');
    for (let ms = 0; ms < 3 * STEP; ms += STEP) t.push(note(ms), 1);
    expect(t.push(note(8100), 1)).toEqual([]);
    t.setLastTip({ title: '키 위에 손가락', sub: '손가락을 키에 올려 둬요' });
    for (let ms = 8250; ms < 16000; ms += STEP) t.push(note(ms), 2);
    const [seg] = t.push(note(16100), 2);
    expect(seg.facts.input).toBe('keyboard');
    expect(seg.facts.hands).toEqual({ weakHand: null, ratio: null });
    expect(seg.facts.previous.counts).toEqual({ perfect: 0, good: 3, miss: 0 });
    expect(seg.facts.previous.lastTip?.title).toBe('키 위에 손가락');
  });

  it('규칙 지적과 원인은 그 구간에 붙고 UNKNOWN은 빼며, 재시작하면 처음부터다', () => {
    const t = new SegmentTracker(CHART, 60, 'stick');
    t.noteRuleCoach(3000, 'LIVE_LATE', 'UNKNOWN');
    t.noteRuleCoach(3500, 'LIVE_PAD_MISS', 'WRONG_PAD');
    for (let ms = 0; ms < 8000; ms += STEP) t.push(note(ms), 1);
    const [seg] = t.push(note(8100), 2);
    expect(seg.facts.ruleCoach).toEqual({ tags: ['LIVE_LATE', 'LIVE_PAD_MISS'], causes: ['WRONG_PAD'] });
    t.reset();
    expect(t.push(note(100), 0)).toEqual([]);
  });
});

// 손별 기준 자세(도)와 판정 반경 20도. 두 손 모두 같은 기준
const RADIUS = 20;
function anchorSet(): Partial<Record<PadId, PadAnchor>> {
  const a = (pad: PadId, pitch: number, yaw: number): PadAnchor => ({ pad, pitch, yaw, radius: RADIUS, samples: 2, spread: 0 });
  return { SNARE: a('SNARE', -30, 0), SMALL_TOM: a('SMALL_TOM', -15, 40), HIHAT: a('HIHAT', -20, -45) };
}
const ANCHORS: HandAnchors = [anchorSet(), anchorSet()];
const AIM: AimSource = { anchors: ANCHORS };

/** 기준보다 dPitch·dYaw(도)만큼 벗어나 친 스틱 타격 */
function aimed(t: number, pad: PadId, dPitch: number, dYaw = 0, stickId: 0 | 1 = 1): JudgedNote {
  const ref = anchorSet()[pad]!;
  return { ...note(t, 'GOOD', 10, pad), stickId, pose: { pitch: ref.pitch + dPitch, yaw: ref.yaw + dYaw } };
}

describe('스틱 끝 방향(aim)', () => {
  it('낮게 친 패드는 LOW이고, 반경 대비 정도와 손을 센다', () => {
    const t = new SegmentTracker(CHART, 60, 'stick', AIM);
    for (let ms = 0; ms < 8000; ms += STEP) t.push(aimed(ms, 'SNARE', -0.7 * RADIUS, 0, 0), 1);
    const [seg] = t.push(note(8100), 2);
    expect(seg.facts.aim).toEqual([{ pad: 'SNARE', hits: 32, wrongPad: 0, vertical: 'LOW', horizontal: null, size: 'CLEAR', hand: 'LEFT' }]);
    expect(seg.facts.contractVersion).toBe(1);
  });

  it('치우침이 작거나 타격이 4개 미만이면 넣지 않는다', () => {
    const small = new SegmentTracker(CHART, 60, 'stick', AIM);
    for (let ms = 0; ms < 8000; ms += STEP) small.push(aimed(ms, 'SNARE', -0.1 * RADIUS), 1);
    expect(small.push(note(8100), 2)[0].facts.aim).toBeUndefined();
    expect(aimFacts([0, 1, 2].map(() => ({ notePad: 'SNARE' as PadId, stickId: 0 as const, pose: { pitch: -50, yaw: 0 }, wrongPad: false })), AIM)).toEqual([]);
  });

  it('키보드 판과 기준이 없는 판에는 aim이 없다', () => {
    const kb = new SegmentTracker(CHART, 60, 'keyboard', AIM);
    for (let ms = 0; ms < 8000; ms += STEP) kb.push(aimed(ms, 'SNARE', -0.7 * RADIUS), 1);
    expect(kb.push(note(8100), 2)[0].facts.aim).toBeUndefined();
    const none = new SegmentTracker(CHART, 60, 'stick');
    for (let ms = 0; ms < 8000; ms += STEP) none.push(aimed(ms, 'SNARE', -0.7 * RADIUS), 1);
    expect(none.push(note(8100), 2)[0].facts.aim).toBeUndefined();
  });

  it('놓친 노트 근처에서 다른 패드로 잡힌 타격은 그 노트 패드의 wrongPad로 센다', () => {
    const t = new SegmentTracker(CHART, 60, 'stick', AIM);
    for (let ms = 0; ms < 8000; ms += STEP) {
      if (ms % 1000 === 0) {
        // 스몰탐을 치려다 낮게 쳐서 스네어로 잡혔다: 채보 밖 타격이 먼저 오고 놓침 판정이 뒤에 온다
        t.noteStray('SNARE', ms + 10, 1, { pitch: -15 - 0.7 * RADIUS, yaw: 40 });
        t.push(note(ms, 'MISS', null, 'SMALL_TOM'), 1);
      } else t.push(aimed(ms, 'SNARE', 0), 1);
    }
    const [seg] = t.push(note(8100), 2);
    expect(seg.facts.aim?.[0]).toMatchObject({ pad: 'SMALL_TOM', hits: 8, wrongPad: 8, vertical: 'LOW', size: 'CLEAR' });
  });

  it('방위각을 믿을 수 없는 손이면 좌우를 말하지 않는다', () => {
    const hits = Array.from({ length: 6 }, () => ({ notePad: 'SNARE' as PadId, stickId: 1 as const, pose: { pitch: -30, yaw: 0.5 * RADIUS }, wrongPad: false }));
    expect(aimFacts(hits, AIM)[0]).toMatchObject({ horizontal: 'RIGHT', vertical: null, size: 'SLIGHT' });
    expect(aimFacts(hits, { ...AIM, trustYaw: () => false })).toEqual([]);
    expect(aimFacts(hits.map((h) => ({ ...h, pose: { pitch: -30, yaw: AIM_CLEAR * RADIUS } })), AIM)[0].size).toBe('CLEAR');
  });

  it('LiveCoach가 채보 밖 타격의 방향도 구간에 넘긴다', () => {
    const segs: FinishedSegment[] = [];
    const coach = new LiveCoach({ goodMs: 60, enabled: true, gate: null, segments: { chart: CHART, input: 'stick', onSegment: (s) => segs.push(s), aim: AIM } });
    for (let ms = 0; ms < 8000; ms += STEP) {
      if (ms % 1000 === 0) {
        coach.pushStray('SNARE', ms + 10, 1, { pitch: -15 - 0.7 * RADIUS, yaw: 40 });
        coach.push(note(ms, 'MISS', null, 'SMALL_TOM'));
      } else coach.push(aimed(ms, 'SNARE', 0));
    }
    coach.push(note(8100));
    expect(segs[0]?.facts.aim?.[0]).toMatchObject({ pad: 'SMALL_TOM', wrongPad: 8 });
  });
});

describe('판정 폭과 대신 친 패드', () => {
  it('사실에 판정 폭과, 놓친 패드마다 대신 가장 많이 친 패드가 들어간다', () => {
    const t = new SegmentTracker(CHART, 60, 'keyboard');
    for (let ms = 0; ms < 8000; ms += STEP) {
      if (ms % 1000 === 0) {
        // 스몰탐 칠 차례에 미드탐을 쳤다: 채보 밖 타격이 먼저, 놓침 판정이 뒤에 온다. 키보드 타격도 센다
        t.noteStray('MID_TOM', ms + 10);
        t.push(note(ms, 'MISS', null, 'SMALL_TOM'), 1);
      } else t.push(note(ms), 1);
    }
    const [seg] = t.push(note(8100), 2);
    expect(seg.facts.timing.goodMs).toBe(60);
    expect(seg.facts.pads.find((p) => p.pad === 'SMALL_TOM')).toMatchObject({ misses: 8, instead: 'MID_TOM' });
    expect(seg.facts.aim).toBeUndefined();
  });

  it('근처에 채보 밖 타격이 없으면 instead는 null이다', () => {
    const t = new SegmentTracker(CHART, 60, 'stick');
    for (let ms = 0; ms < 8000; ms += STEP) t.push(note(ms, ms % 1000 === 0 ? 'MISS' : 'GOOD', 30), 1);
    const [seg] = t.push(note(8100), 2);
    expect(seg.facts.pads[0].instead).toBeNull();
  });
});

/** 응답 순서를 정해 둔 가짜 BE와 수동 시계 */
function fakeClient(polls: Awaited<ReturnType<LlmCoachClient['poll']>>[], request: Awaited<ReturnType<LlmCoachClient['request']>> = { requestId: 'r1' }) {
  const calls: { runId: string }[] = [];
  const client: LlmCoachClient = {
    request: async (runId) => {
      calls.push({ runId });
      return request;
    },
    poll: async () => polls.shift() ?? { kind: 'pending' },
  };
  return { client, calls };
}

function segment(nextDurationMs = 8000): FinishedSegment {
  const t = new SegmentTracker(CHART, 60, 'stick');
  for (let ms = 0; ms < 8000; ms += STEP) t.push(note(ms), 1);
  const [seg] = t.push(note(8100), 2);
  return { ...seg, nextDurationMs };
}

function llmCoach(client: LlmCoachClient, mode: 'shadow' | 'on' = 'on') {
  let clock = 0;
  const tips: LlmTip[] = [];
  const records: LlmRecord[] = [];
  const c = new LlmCoach({
    client,
    mode,
    runId: 'run-1',
    onTip: (t) => tips.push(t),
    onRecord: (r) => records.push(r),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { c, tips, records };
}

describe('요청·조회·기한', () => {
  const done = { kind: 'done' as const, title: '스틱을 낮게', sub: '높이는 주먹 하나만큼', model: 'gemma3:4b', generationMs: 1100 };

  it('기한 안에 온 문구를 넘기고(on), shadow는 넘기지 않고 기록만 한다', async () => {
    const on = llmCoach(fakeClient([{ kind: 'pending' }, done]).client);
    await on.c.submit(segment());
    expect(on.tips[0]).toMatchObject({ title: '스틱을 낮게', segment: 0, model: 'gemma3:4b', latencyMs: 1000 });
    expect(on.records).toEqual([]);

    const shadow = llmCoach(fakeClient([done]).client, 'shadow');
    await shadow.c.submit(segment());
    expect(shadow.tips).toEqual([]);
    expect(shadow.records[0]).toMatchObject({ status: 'SHADOW', title: '스틱을 낮게' });
  });

  it('기한(다음 구간 길이의 절반)이 지나면 LATE로 남기고 버린다', async () => {
    const { c, tips, records } = llmCoach(fakeClient([]).client);
    await c.submit(segment(4000)); // 기한 2초
    expect(tips).toEqual([]);
    expect(records[0]).toMatchObject({ status: 'LATE' });
  });

  it('실패·만료는 FAILED, 꺼짐은 SKIPPED, 상한 초과 뒤에는 그 판의 남은 구간을 요청하지 않는다', async () => {
    const gone = llmCoach(fakeClient([{ kind: 'gone' }]).client);
    await gone.c.submit(segment());
    expect(gone.records[0].status).toBe('FAILED');

    const off = llmCoach(fakeClient([], null).client);
    await off.c.submit(segment());
    expect(off.records[0].status).toBe('SKIPPED');

    const limited = fakeClient([], 'limit');
    const l = llmCoach(limited.client);
    await l.c.submit(segment());
    await l.c.submit(segment());
    expect(l.records.map((r) => r.status)).toEqual(['SKIPPED', 'SKIPPED']);
    expect(limited.calls).toHaveLength(1);
  });

  it('다시 하기·종료 뒤 도착한 결과는 넘기지 않고, 다시 하기면 새 판 번호로 요청한다', async () => {
    const f = fakeClient([{ kind: 'pending' }, done]);
    const { c, tips, records } = llmCoach(f.client);
    const pending = c.submit(segment());
    c.cancel('run-2');
    await pending;
    expect(tips).toEqual([]);
    expect(records).toEqual([]);
    await c.submit(segment());
    expect(f.calls.map((x) => x.runId)).toEqual(['run-1', 'run-2']);
  });
});

describe('LiveCoach와 LLM 구간 문구', () => {
  const tip = (over: Partial<LlmTip> = {}): LlmTip => ({ title: '스틱을 낮게', sub: '높이는 주먹 하나만큼', segment: 0, model: 'gemma3:4b', latencyMs: 1200, expiresInMs: 3000, ...over });
  const events = (c: LiveCoach) => c.events().filter((e) => e.tag === LIVE_LLM_TAG).map((e) => JSON.parse(e.text));

  it('구간이 끝나면 onSegment로 사실을 넘긴다', () => {
    const got: FinishedSegment[] = [];
    const coach = new LiveCoach({ goodMs: 60, gate: null, segments: { chart: CHART, input: 'stick', onSegment: (s) => got.push(s) } });
    for (let ms = 0; ms <= 8250; ms += STEP) coach.push(note(ms, 'PERFECT', 0));
    expect(got).toHaveLength(1);
    expect(got[0].facts.stage).toBeGreaterThanOrEqual(2);
  });

  it('규칙 지적이 떠 있지 않으면 바로 띄우고 SHOWN으로 남긴다. 화면 문구는 LLM 문구 그대로다', () => {
    const coach = new LiveCoach({ goodMs: 60, gate: null, llmArm: 'llm' });
    const m = coach.offerLlmTip(tip(), 5000);
    expect(m).toMatchObject({ tag: 'LIVE_LLM', displayMs: 4000, llm: { title: '스틱을 낮게', sub: '높이는 주먹 하나만큼' } });
    expect(coachCopy(m!)).toEqual({ title: '스틱을 낮게', sub: '높이는 주먹 하나만큼', mode: 'coach-info', target: null });
    expect(events(coach)[0]).toMatchObject({ segment: 0, status: 'SHOWN', model: 'gemma3:4b' });
    expect(JSON.parse(coach.events()[0].text)).toEqual({ llmArm: 'llm' });
  });

  it('규칙 지적이 떠 있으면 기다렸다가 다음 칭찬 자리에 띄우고, 기한이 지나면 LATE로 버린다', () => {
    const late = (i: number) => note(i * 500, 'GOOD', 40);
    const coach = new LiveCoach({ goodMs: 60, gate: null });
    let t = 0;
    for (let i = 0; i < 12; i++) {
      if (coach.push(late(i))?.tag === 'LIVE_LATE') t = late(i).songTimeMs;
    }
    expect(t).toBeGreaterThan(0);
    expect(coach.offerLlmTip(tip({ expiresInMs: 500 }), t + 100)).toBeNull();
    // 기한(곡 시각 +500ms)이 지난 뒤의 판정
    coach.push(note(t + 2000, 'PERFECT', 0));
    expect(events(coach).map((e) => e.status)).toEqual(['LATE']);
  });

  it('구간 결과 기록(SHADOW 등)을 남기고, 재시작하면 기다리던 문구를 버린다', () => {
    const coach = new LiveCoach({ goodMs: 60, gate: null });
    coach.recordLlm({ segment: 2, status: 'SHADOW', title: '입으로 세요', sub: '', model: 'm', latencyMs: 900 }, 20000);
    expect(events(coach)[0]).toMatchObject({ segment: 2, status: 'SHADOW' });
    coach.reset();
    expect(events(coach)).toEqual([]);
  });

  it('코칭을 끄면 LLM 문구도 받지 않는다', () => {
    const off = new LiveCoach({ goodMs: 60, enabled: false });
    expect(off.offerLlmTip(tip(), 1000)).toBeNull();
  });
});

describe('실험 설정 llm', () => {
  const base = { gate: { mode: 'off', arms: [] }, cause: { arms: [] }, rolloutPercent: 0 };

  it('없으면 off, 형식이 틀리면 설정 전체를 쓰지 않는다', () => {
    expect(parseCoachLiveConfig(base)?.llm).toEqual({ mode: 'off', rolloutPercent: 0 });
    expect(parseCoachLiveConfig({ ...base, llm: { mode: 'on', rolloutPercent: 50 } })?.llm).toEqual({ mode: 'on', rolloutPercent: 50 });
    expect(parseCoachLiveConfig({ ...base, llm: { mode: 'maybe', rolloutPercent: 50 } })).toBeNull();
    expect(parseCoachLiveConfig({ ...base, llm: { mode: 'on', rolloutPercent: 101 } })).toBeNull();
  });

  it('로그인 사용자만, 비율 안에서 같은 사용자는 늘 같은 결과다', () => {
    const cfg = parseCoachLiveConfig({ ...base, llm: { mode: 'shadow', rolloutPercent: 100 } })!;
    expect(assignLlm(cfg, null)).toBe(false);
    expect(assignLlm(cfg, 7)).toBe(true);
    const half = parseCoachLiveConfig({ ...base, llm: { mode: 'shadow', rolloutPercent: 50 } })!;
    expect(assignLlm(half, 7)).toBe(assignLlm(half, 7));
    const off = parseCoachLiveConfig({ ...base, llm: { mode: 'off', rolloutPercent: 100 } })!;
    expect(assignLlm(off, 7)).toBe(false);
  });
});
