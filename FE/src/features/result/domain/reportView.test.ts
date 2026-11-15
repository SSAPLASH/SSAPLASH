// 리포트 화면용 계산 (설계 COACH-002 리포트 화면 개편 3장)
import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import type { PadStat, ReportNote, WeakSegment } from '@/domain/play/report';
import {
  clockHundredth,
  clockRange,
  clockTenth,
  deltaText,
  flowBins,
  flowTotalMs,
  focusBasis,
  focusHeadline,
  focusOfBin,
  focusOfCluster,
  focusOfSegment,
  focusOfTransition,
  initialFocus,
  noteVerdict,
  notesInRange,
  observationText,
  OFF_BEAT_LABEL,
  padRows,
  splitSegments,
  transitionWindow,
  VERDICT_LABEL,
  verdictCounts,
} from './reportView';

let seq = 0;
const note = (timeMs: number, pad: PadId, judgement: ReportNote['judgement'] = 'PERFECT', deltaMs: number | null = 0): ReportNote => ({
  seq: seq++,
  noteId: null,
  timeMs,
  pad,
  judgement,
  deltaMs: judgement === 'MISS' ? null : deltaMs,
  velocity: null,
});
const seg = (over: Partial<WeakSegment> = {}): WeakSegment => ({
  fromMs: 12300,
  toMs: 17300,
  pattern: 'MISS_CLUSTER',
  description: '이 구간에서 많이 놓쳐요.',
  causeTags: [],
  pads: ['RIDE'],
  severity: 0.8,
  scope: 'SEGMENT',
  metrics: { missRate: 1, missCount: 8, noteCount: 8 },
  ...over,
});
const stat = (pad: PadId, accuracy: number | null, total: number, meanDeltaMs: number | null = 0): PadStat => ({
  pad,
  accuracy,
  meanDeltaMs,
  meanVelocity: null,
  counts: { PERFECT: total, GOOD: 0, MISS: 0 },
  sampleCount: total,
});

describe('시각·오차 문구', () => {
  it('clockTenth: 0.1초 단위, 딱 떨어지면 소수 없음', () => {
    expect(clockTenth(12300)).toBe('0:12.3');
    expect(clockTenth(79300)).toBe('1:19.3');
    expect(clockTenth(46000)).toBe('0:46');
    expect(clockTenth(-5)).toBe('0:00');
  });
  it('clockHundredth: 항상 0.01초 단위', () => {
    expect(clockHundredth(13340)).toBe('0:13.34');
    expect(clockHundredth(16000)).toBe('0:16.00');
    expect(clockHundredth(83970)).toBe('1:23.97');
  });
  it('clockRange: 초 단위로 내려 「0:12–0:17」', () => {
    expect(clockRange(12300, 17300)).toBe('0:12–0:17');
    expect(clockRange(79300, 84300)).toBe('1:19–1:24');
  });
  it('deltaText: 음수는 빠름, 양수는 늦음, 0은 정시, 없으면 빈 글자', () => {
    expect(deltaText(-39)).toBe('39ms 빠름');
    expect(deltaText(13.4)).toBe('13ms 늦음');
    expect(deltaText(0)).toBe('정시');
    expect(deltaText(null)).toBe('');
  });
});

describe('노트 구분(정확·빠름·늦음·놓침)', () => {
  it('GOOD은 오차가 음수면 빠름, 양수면 늦음. PERFECT·MISS는 그대로', () => {
    expect(noteVerdict(note(0, 'KICK', 'GOOD', -39))).toBe('EARLY');
    expect(noteVerdict(note(0, 'KICK', 'GOOD', 41))).toBe('LATE');
    expect(noteVerdict(note(0, 'KICK', 'PERFECT', -12))).toBe('PERFECT');
    expect(noteVerdict(note(0, 'KICK', 'MISS'))).toBe('MISS');
  });
  it('오차가 0이거나 없는 GOOD(서버 계약상 오지 않는다)은 늦음에 센다', () => {
    expect(noteVerdict({ judgement: 'GOOD', deltaMs: 0 })).toBe('LATE');
    expect(noteVerdict({ judgement: 'GOOD', deltaMs: null })).toBe('LATE');
  });
  it('구분별로 세고, 빠름 + 늦음은 GOOD 수와 같다', () => {
    const notes = [note(0, 'KICK'), note(1, 'KICK', 'GOOD', -30), note(2, 'KICK', 'GOOD', -45), note(3, 'KICK', 'GOOD', 50), note(4, 'KICK', 'MISS')];
    const counts = verdictCounts(notes);
    expect(counts).toEqual({ PERFECT: 1, EARLY: 2, LATE: 1, MISS: 1 });
    expect(counts.EARLY + counts.LATE).toBe(notes.filter((n) => n.judgement === 'GOOD').length);
  });
  it('화면 이름에 「타이밍 차이」가 없다', () => {
    expect(VERDICT_LABEL).toEqual({ PERFECT: '정확', EARLY: '빠름', LATE: '늦음', MISS: '놓침' });
    expect(OFF_BEAT_LABEL).toBe('빠름·늦음');
  });
});

describe('flowBins', () => {
  const notes = [note(0, 'KICK'), note(4999, 'SNARE', 'GOOD'), note(5000, 'KICK', 'MISS'), note(12000, 'HIHAT', 'MISS')];
  it('곡 길이를 알면 그 길이를 5초 단위로 올려 칸을 만든다', () => {
    expect(flowTotalMs(notes, 178100)).toBe(180000);
    expect(flowBins(notes, 180000)).toHaveLength(36);
  });
  it('곡 길이를 모르면 마지막 노트 기준', () => {
    expect(flowTotalMs(notes, null)).toBe(15000);
    expect(flowTotalMs([], null)).toBe(5000);
  });
  it('노트가 곡 길이보다 뒤에 있으면 노트 기준으로 늘린다', () => {
    expect(flowTotalMs(notes, 10000)).toBe(15000);
  });
  it('칸마다 판정 수를 센다(시작 포함, 끝 미포함)', () => {
    const bins = flowBins(notes, 15000);
    expect(bins.map((b) => [b.fromMs, b.perfect, b.good, b.miss])).toEqual([
      [0, 1, 1, 0],
      [5000, 0, 0, 1],
      [10000, 0, 0, 1],
    ]);
  });
  it('칸마다 빠름·늦음을 나눠 세고, 둘의 합이 그 칸의 GOOD 수다', () => {
    const mixed = [note(100, 'KICK', 'GOOD', -40), note(200, 'KICK', 'GOOD', -30), note(300, 'KICK', 'GOOD', 45), note(400, 'KICK'), note(6000, 'KICK', 'GOOD', 50), note(6100, 'KICK', 'MISS')];
    const bins = flowBins(mixed, 10000);
    expect(bins.map((b) => [b.fromMs, b.perfect, b.early, b.late, b.good, b.miss])).toEqual([
      [0, 1, 2, 1, 3, 0],
      [5000, 0, 0, 1, 1, 1],
    ]);
  });
});

describe('splitSegments', () => {
  it('놓친 구간·전환·그 밖으로 나눈다', () => {
    const late = seg({ pattern: 'TIMING_LATE', scope: 'WHOLE', fromMs: 0, toMs: 180000, metrics: {} });
    const padLate = seg({ pattern: 'PAD_LATE', fromMs: 3000, toMs: 9000, metrics: {} });
    const c2 = seg({ fromMs: 79300, toMs: 84300 });
    const c1 = seg();
    const t = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 2000, toMs: 170000, metrics: { transitionCount: 58, missCount: 57, missRate: 0.98 } });
    const r = splitSegments([padLate, c2, late, t, c1]);
    expect(r.clusters).toEqual([c1, c2]);
    expect(r.transitions).toEqual([t]);
    expect(r.others).toEqual([late, padLate]);
  });
  it('연주 전체 범위의 MISS_CLUSTER나 패드가 2개 미만인 전환은 그 밖으로', () => {
    const whole = seg({ scope: 'WHOLE' });
    const bad = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK'] });
    expect(splitSegments([whole, bad])).toEqual({ clusters: [], transitions: [], others: [whole, bad] });
  });
  it('null·빈 목록은 모두 빈 목록', () => {
    expect(splitSegments(null)).toEqual({ clusters: [], transitions: [], others: [] });
    expect(splitSegments([])).toEqual({ clusters: [], transitions: [], others: [] });
  });
});

describe('notesInRange', () => {
  it('시작 포함, 끝 미포함', () => {
    const notes = [note(999, 'KICK'), note(1000, 'KICK'), note(1999, 'KICK'), note(2000, 'KICK')];
    expect(notesInRange(notes, 1000, 2000).map((n) => n.timeMs)).toEqual([1000, 1999]);
  });
});

describe('transitionWindow', () => {
  // 킥 → 스네어 전환: 10.5초(놓침), 46.0·46.5·47.0초(46.0·47.0 놓침), 100초(정확)
  const notes = [
    note(10000, 'KICK'),
    note(10500, 'SNARE', 'MISS'),
    note(45700, 'KICK'),
    note(46000, 'SNARE', 'MISS'),
    note(46200, 'KICK'),
    note(46500, 'SNARE'),
    note(46800, 'KICK'),
    note(47000, 'SNARE', 'MISS'),
    note(99500, 'KICK'),
    note(100000, 'SNARE'),
  ];
  const t = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 10000, toMs: 100001 });
  it('놓친 전환이 가장 많이 든 8초 창을 고르고 시작을 초 단위로 내린다', () => {
    expect(transitionWindow(notes, t, true)).toEqual({ fromMs: 45000, toMs: 53000 });
  });
  it('놓침만 보지 않으면 전환이 가장 많이 든 창', () => {
    expect(transitionWindow(notes, t, false)).toEqual({ fromMs: 45000, toMs: 53000 });
  });
  it('놓친 전환이 없으면 전체 전환으로 고른다', () => {
    const clean = notes.map((n) => ({ ...n, judgement: 'PERFECT' as const }));
    expect(transitionWindow(clean, t, true)).toEqual({ fromMs: 45000, toMs: 53000 });
  });
  it('전환 노트가 없으면 약점 구간의 앞 8초', () => {
    expect(transitionWindow([note(0, 'HIHAT')], t, true)).toEqual({ fromMs: 10000, toMs: 18000 });
    const short = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 1000, toMs: 4000 });
    expect(transitionWindow([], short, true)).toEqual({ fromMs: 1000, toMs: 4000 });
  });
});

describe('padRows', () => {
  it('노트 수 상위 3개를 정확도 낮은 순으로, 나머지는 노트 수 많은 순으로 접는다', () => {
    const stats = [stat('RIDE', 0.487, 53), stat('SNARE', 0.207, 88), stat('CRASH', 0, 10), stat('HIHAT', 0.352, 369), stat('KICK', 0.552, 162), stat('FLOOR_TOM', 0, 4)];
    const r = padRows(stats);
    expect(r.main.map((s) => s.pad)).toEqual(['SNARE', 'HIHAT', 'KICK']);
    expect(r.more.map((s) => s.pad)).toEqual(['RIDE', 'CRASH', 'FLOOR_TOM']);
  });
  it('3개 이하면 접는 줄이 없다', () => {
    const r = padRows([stat('KICK', 0.5, 3), stat('SNARE', null, 1)]);
    expect(r.main.map((s) => s.pad)).toEqual(['KICK', 'SNARE']);
    expect(r.more).toEqual([]);
  });
});

describe('선택(Focus)', () => {
  const notes = [note(13340, 'RIDE', 'MISS'), note(14790, 'RIDE', 'MISS'), note(15530, 'HIHAT', 'MISS'), note(16000, 'CRASH', 'GOOD', -20), note(46000, 'KICK'), note(46240, 'SNARE', 'MISS')];

  it('놓친 구간: 서버 숫자가 있으면 그대로 쓴다', () => {
    const f = focusOfCluster(seg());
    expect(f).toMatchObject({ kind: 'cluster', fromMs: 12300, toMs: 17300, relatedPads: ['RIDE'] });
    expect(focusHeadline(f)).toEqual(['0:12–0:17', '놓친 노트 확인']);
    expect(focusBasis(f, notes)).toBe('노트 8개 중 8개 놓침 · 100%');
  });
  it('놓친 구간: 서버 숫자가 없으면 구간 안 노트로 센다', () => {
    const f = focusOfCluster(seg({ metrics: {} }));
    expect(focusBasis(f, notes)).toBe('노트 4개 중 3개 놓침 · 75%');
    expect(focusBasis(f, null)).toBe('');
  });
  it('전환(놓침): 패드 이름과 전환 횟수', () => {
    const t = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 40000, toMs: 50000, metrics: { transitionCount: 58, missCount: 57, missRate: 0.98 } });
    const f = focusOfTransition(t, notes);
    expect(f).toMatchObject({ kind: 'transition', fromMs: 46000, toMs: 54000, relatedPads: ['KICK', 'SNARE'] });
    expect(focusHeadline(f)).toEqual(['킥 → 스네어', '전환 연습']);
    expect(focusBasis(f, notes)).toBe('전환 58번 중 57번 놓침 · 98%');
    expect(observationText(t)).toEqual({ label: '킥 → 스네어', count: '전환 58번 중 57번 놓침 · 98%' });
  });
  it('전환(늦게 침): 횟수와 평균 오차', () => {
    const t = seg({ pattern: 'TRANSITION_LATE', pads: ['SNARE', 'KICK'], metrics: { transitionCount: 9, hitCount: 8, meanDeltaMs: 40.2 } });
    expect(observationText(t)).toEqual({ label: '스네어 → 킥', count: '전환 9번 · 평균 40ms 늦음' });
  });
  it('전환: 숫자가 없으면 서버 설명을 쓴다', () => {
    const t = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], description: '킥에서 스네어로 넘어갈 때 50%를 놓쳐요.', metrics: {} });
    expect(observationText(t)).toEqual({ label: '킥 → 스네어', count: '킥에서 스네어로 넘어갈 때 50%를 놓쳐요.' });
  });
  it('그 밖의 약점: 설명이 제목 줄, 구간이면 시각', () => {
    const s = seg({ pattern: 'PAD_LATE', pads: ['SNARE'], description: '스네어를 평균 32ms 늦게 쳐요.', fromMs: 3000, toMs: 9000, metrics: {} });
    expect(observationText(s)).toEqual({ label: '스네어를 평균 32ms 늦게 쳐요.', count: '0:03–0:09' });
    expect(observationText({ ...s, scope: 'WHOLE' })).toEqual({ label: '스네어를 평균 32ms 늦게 쳐요.', count: '연주 전체' });
    const f = focusOfSegment(s);
    expect(focusHeadline(f)).toEqual(['0:03–0:09', '구간 확인']);
  });
  it('막대 5초 칸', () => {
    const f = focusOfBin(10000);
    expect(f).toMatchObject({ kind: 'bin', fromMs: 10000, toMs: 15000, segment: null, relatedPads: [] });
    expect(focusHeadline(f)).toEqual(['0:10–0:15', '노트 확인']);
    expect(focusBasis(f, notes)).toBe('노트 2개 중 2개 놓침 · 100%');
  });
  it('처음 선택: 놓친 구간 → 전환 → 놓침이 가장 많은 칸 → 없음', () => {
    const c = seg();
    const t = seg({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 40000, toMs: 50000 });
    expect(initialFocus(splitSegments([t, c]), notes, 50000)?.kind).toBe('cluster');
    expect(initialFocus(splitSegments([t]), notes, 50000)?.kind).toBe('transition');
    expect(initialFocus(splitSegments([]), notes, 50000)).toMatchObject({ kind: 'bin', fromMs: 10000 });
    expect(initialFocus(splitSegments([]), [], 5000)).toBeNull();
  });
});
