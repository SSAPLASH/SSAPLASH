import { describe, expect, it } from 'vitest';
import { JUDGEMENT_SCORE } from './judgement';
import {
  LESSONS_PATH,
  isBeginnerChart,
  lessonsFromDto,
  lessonOfChart,
  lessonPath,
  nextLesson,
  playPassed,
  shouldInvite,
  stageStates,
  type Lesson,
} from './lesson';

const item = (order: number, over: Partial<Record<string, unknown>> = {}) => ({
  order,
  kind: 'PLAY',
  songId: 100 + order,
  chartId: 200 + order,
  title: `레슨 ${order}`,
  summary: '설명',
  pads: ['KICK'],
  guide: true,
  bpm: 70,
  durationMs: 13714,
  noteCount: 16,
  bestAccuracy: null,
  passed: false,
  locked: order > 1,
  ...over,
});

const list = (items: ReturnType<typeof item>[]) => lessonsFromDto({ passAccuracy: 70, items }).items;

describe('lessonsFromDto', () => {
  it('BE 응답을 순서대로 읽는다', () => {
    const r = lessonsFromDto({ passAccuracy: 70, items: [item(2, { kind: 'READ', pads: ['SNARE', 'HIHAT'], guide: false }), item(1)] });
    expect(r.passAccuracy).toBe(70);
    expect(r.items.map((l) => l.order)).toEqual([1, 2]);
    expect(r.items[1]).toMatchObject({ kind: 'READ', songId: 102, chartId: 202, pads: ['SNARE', 'HIHAT'], guide: false });
  });

  it('형식이 틀린 항목은 빼고, 최상위가 틀리면 던진다', () => {
    const r = lessonsFromDto({
      passAccuracy: 70,
      items: [item(1), item(2, { kind: 'WATCH' }), item(3, { songId: -1 }), item(4, { pads: ['COWBELL'] }), item(5, { pads: [] }), null],
    });
    expect(r.items.map((l) => l.order)).toEqual([1]);
    expect(() => lessonsFromDto(null)).toThrow();
    expect(() => lessonsFromDto({ passAccuracy: 70 })).toThrow();
  });

  it('bpm·길이·최고 정확도는 없을 수 있다', () => {
    const [l] = list([item(1, { bpm: null, durationMs: null, bestAccuracy: 82.5 })]);
    expect(l).toMatchObject({ bpm: null, durationMs: null, bestAccuracy: 82.5 });
  });
});

describe('stageStates', () => {
  it('서버 값대로 통과·도전 가능·잠김을 정한다', () => {
    const ls = list([item(1, { passed: true }), item(2, { locked: false }), item(3)]);
    expect(stageStates(ls, new Set())).toEqual(['passed', 'open', 'locked']);
  });

  it('이번 접속에서 통과한 레슨은 업로드 전이어도 통과로 보고 다음을 연다', () => {
    const ls = list([item(1), item(2), item(3)]);
    expect(stageStates(ls, new Set([101]))).toEqual(['passed', 'open', 'locked']);
  });

  it('앞 레슨이 통과 전이면 뒤 레슨이 통과여도 그다음은 잠긴다', () => {
    const ls = list([item(1), item(2, { passed: true }), item(3)]);
    expect(stageStates(ls, new Set())).toEqual(['open', 'passed', 'locked']);
  });
});

describe('nextLesson · lessonOfChart · lessonPath', () => {
  const ls: Lesson[] = list([item(1, { kind: 'READ' }), item(2), item(3)]);

  it('다음 레슨과 채보로 찾은 레슨', () => {
    expect(nextLesson(ls, 101)?.order).toBe(2);
    expect(nextLesson(ls, 103)).toBeNull();
    expect(nextLesson(ls, 999)).toBeNull();
    expect(lessonOfChart(ls, 202)?.order).toBe(2);
    expect(lessonOfChart(ls, 999)).toBeUndefined();
    expect(lessonOfChart(ls, null)).toBeUndefined();
  });

  it('연주 레슨은 탭을 유지한 악보 연습, 알아보기 레슨은 알아보기 화면으로 간다', () => {
    expect(lessonPath(ls[1])).toBe('/sheet?tab=lessons&song=102&chart=202&start=1');
    expect(lessonPath(ls[0])).toBe('/sheet/lesson/101');
    expect(LESSONS_PATH).toBe('/sheet?tab=lessons');
  });
});

describe('playPassed', () => {
  it('서버와 같은 반올림(소수 둘째 자리)으로 기준(70%) 이상이면 통과', () => {
    expect(playPassed({ score: 1400, noteCount: 20 }, 70)).toBe(true);
    expect(playPassed({ score: 6999, noteCount: 100 }, 70)).toBe(false);
    expect(playPassed({ score: 69995, noteCount: 1000 }, 70)).toBe(true);
    expect(playPassed({ score: 0, noteCount: 0 }, 70)).toBe(false);
  });

  it('GOOD 점수(SCORE_V2 80점) 기준: 하나도 놓치지 않고 전부 GOOD이면 70%를 넘어 통과한다', () => {
    const score = (perfect: number, good: number) => perfect * JUDGEMENT_SCORE.PERFECT + good * JUDGEMENT_SCORE.GOOD;
    // 16노트 레슨 전부 GOOD = 80%
    expect(playPassed({ score: score(0, 16), noteCount: 16 }, 70)).toBe(true);
    // 전부 GOOD이면 16개 중 MISS 2개까지(14×80 / 16 = 70%)
    expect(playPassed({ score: score(0, 14), noteCount: 16 }, 70)).toBe(true);
    expect(playPassed({ score: score(0, 13), noteCount: 16 }, 70)).toBe(false);
    // PERFECT 2·GOOD 10·MISS 4(11/12 로컬 기록) = 62.5%
    expect(playPassed({ score: score(2, 10), noteCount: 16 }, 70)).toBe(false);
  });
});

describe('shouldInvite', () => {
  const ls = list([item(1), item(2)]);
  const base = { authed: true, lessons: ls, localPassed: new Set<number>(), dismissed: false, onLessonsTab: false };

  it('로그인했고 레슨이 있고 통과한 레슨이 없고 닫은 적 없으면 보인다', () => {
    expect(shouldInvite(base)).toBe(true);
  });

  it('하나라도 조건이 어긋나면 숨긴다', () => {
    expect(shouldInvite({ ...base, authed: false })).toBe(false);
    expect(shouldInvite({ ...base, lessons: [] })).toBe(false);
    expect(shouldInvite({ ...base, lessons: null })).toBe(false);
    expect(shouldInvite({ ...base, dismissed: true })).toBe(false);
    expect(shouldInvite({ ...base, onLessonsTab: true })).toBe(false);
    expect(shouldInvite({ ...base, localPassed: new Set([101]) })).toBe(false);
    expect(shouldInvite({ ...base, lessons: list([item(1, { passed: true }), item(2)]) })).toBe(false);
  });
});

describe('readSequence · readStep (알아보기 레슨)', () => {
  it('채보 노트를 시간 순 패드 줄로 만든다', async () => {
    const { readSequence } = await import('./lesson');
    expect(readSequence([{ timeMs: 857, pad: 'SNARE' }, { timeMs: 0, pad: 'KICK' }, { timeMs: 1714, pad: 'HIHAT' }])).toEqual(['KICK', 'SNARE', 'HIHAT']);
  });

  it('맞는 패드면 다음 음표로, 틀리면 그대로 두고 틀렸다고 알린다, 끝까지 치면 done', async () => {
    const { readStep } = await import('./lesson');
    const seq = ['KICK', 'SNARE'] as const;
    expect(readStep(seq, 0, 'KICK')).toEqual({ at: 1, miss: false, done: false });
    expect(readStep(seq, 1, 'KICK')).toEqual({ at: 1, miss: true, done: false });
    expect(readStep(seq, 1, 'SNARE')).toEqual({ at: 2, miss: false, done: true });
    // 이미 끝났으면 무엇을 쳐도 그대로다
    expect(readStep(seq, 2, 'HIHAT')).toEqual({ at: 2, miss: false, done: true });
  });

  it('하이햇 페달·라이드는 하이햇 음표의 답이 아니다', async () => {
    const { readStep } = await import('./lesson');
    expect(readStep(['HIHAT'], 0, 'HIHAT_PEDAL').miss).toBe(true);
    expect(readStep(['HIHAT'], 0, 'RIDE').miss).toBe(true);
  });
});

describe('readDeviceHint (검증 추가 발견 2)', () => {
  const base = { sensorKind: 'imu' as const, hasUsageGuide: false, sticks: [false, false] as [boolean, boolean], pedal: [true, true] as [boolean, boolean], pads: ['SNARE'] as const };

  it('연결 개념이 있는 센서인데 스틱이 하나도 없으면 스틱 안내', async () => {
    const { readDeviceHint } = await import('./lesson');
    expect(readDeviceHint({ ...base })).toBe('스틱을 연결해 주세요. 아래 드럼 그림을 눌러도 돼요.');
    expect(readDeviceHint({ ...base, sticks: [true, false] })).toBeNull();
  });

  it('키보드 전용·사용 안내가 있는 소스(포인터 등)는 안내하지 않는다', async () => {
    const { readDeviceHint } = await import('./lesson');
    expect(readDeviceHint({ ...base, sensorKind: 'none' })).toBeNull();
    expect(readDeviceHint({ ...base, hasUsageGuide: true })).toBeNull();
  });

  it('동글이면 발로 치는 패드가 있는 레슨에서만 페달 연결을 본다', async () => {
    const { readDeviceHint } = await import('./lesson');
    const pedalOff = { ...base, sensorKind: 'webserial' as const, sticks: [true, true] as [boolean, boolean], pedal: [false, false] as [boolean, boolean] };
    expect(readDeviceHint({ ...pedalOff, pads: ['KICK'] })).toBe('페달을 연결해 주세요. 아래 드럼 그림을 눌러도 돼요.');
    expect(readDeviceHint({ ...pedalOff, pads: ['SNARE'] })).toBeNull();
    expect(readDeviceHint({ ...pedalOff, sensorKind: 'imu', pads: ['KICK'] })).toBeNull();
  });
});

describe('lessonDisplayTitle', () => {
  it('코스 안에서는 「입문 · 」 머리말을 뺀다', async () => {
    const { lessonDisplayTitle } = await import('./lesson');
    expect(lessonDisplayTitle('입문 · 킥으로 박자 세기')).toBe('킥으로 박자 세기');
    expect(lessonDisplayTitle('기본 8비트')).toBe('기본 8비트');
  });
});

describe('isBeginnerChart', () => {
  const lessons = list([item(1), item(2, { kind: 'READ' })]);

  it('EASY 채보는 레슨 목록과 상관없이 대상이다', () => {
    expect(isBeginnerChart({ difficulty: 'EASY', chartId: 999, lessons: [] })).toBe(true);
  });

  it('입문 코스 연주 레슨의 채보는 NORMAL이어도 대상이다', () => {
    expect(isBeginnerChart({ difficulty: 'NORMAL', chartId: 201, lessons })).toBe(true);
  });

  it('알아보기(READ) 레슨 채보와 그 밖의 채보는 대상이 아니다', () => {
    expect(isBeginnerChart({ difficulty: 'NORMAL', chartId: 202, lessons })).toBe(false);
    expect(isBeginnerChart({ difficulty: 'HARD', chartId: 999, lessons })).toBe(false);
    expect(isBeginnerChart({ difficulty: 'NORMAL', chartId: null, lessons })).toBe(false);
  });

  it('레슨 목록을 아직 못 읽었으면 난이도만 본다', () => {
    expect(isBeginnerChart({ difficulty: 'NORMAL', chartId: 201, lessons: [] })).toBe(false);
  });
});
