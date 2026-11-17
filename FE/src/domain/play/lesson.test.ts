import { describe, expect, it } from 'vitest';
import { JUDGEMENT_SCORE } from './judgement';
import {
  AUTO_ADVANCE_SECONDS,
  LESSON_TAIL_MS,
  COURSES,
  autoAdvanceTarget,
  autoAdvanceText,
  LESSONS_PATH,
  courseFinishText,
  courseOfQuery,
  coursePath,
  courseProgress,
  courseQuery,
  defaultCourse,
  isBeginnerChart,
  lessonsFromDto,
  lessonsOfCourse,
  lessonOfChart,
  lessonPath,
  nextLesson,
  playPassed,
  shouldInvite,
  stageStates,
  trimLessonTail,
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

  it('연주 레슨은 탭·코스를 유지한 악보 연습, 알아보기 레슨은 알아보기 화면으로 간다', () => {
    expect(lessonPath(ls[1])).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1');
    expect(lessonPath({ ...ls[1], course: 'INTERMEDIATE' })).toBe('/sheet?tab=lessons&course=intermediate&song=102&chart=202&start=1');
    expect(lessonPath(ls[0])).toBe('/sheet/lesson/101');
    expect(LESSONS_PATH).toBe('/sheet?tab=lessons');
  });
});

// 학습 코스 설계 3-4절
describe('학습 코스(입문·중급)', () => {
  const both = () =>
    list([
      item(1, { kind: 'READ', passed: true, locked: false }),
      item(2, { locked: false }),
      item(1, { course: 'INTERMEDIATE', songId: 301, chartId: 401 }),
      item(2, { course: 'INTERMEDIATE', songId: 302, chartId: 402 }),
    ]);

  it('응답의 course를 읽고, 없거나 모르는 값은 입문으로 본다. 정렬은 코스 → 코스 안 순서', () => {
    const r = lessonsFromDto({
      passAccuracy: 70,
      items: [item(1, { course: 'INTERMEDIATE', songId: 301 }), item(2), item(1, { course: 'ADVANCED' })],
    });
    expect(r.items.map((l) => `${l.course}:${l.order}`)).toEqual(['BEGINNER:1', 'BEGINNER:2', 'INTERMEDIATE:1']);
  });

  it('코스 목록은 입문 → 중급 순서이고 주소 값과 서로 바뀐다', () => {
    expect(COURSES.map((c) => c.name)).toEqual(['입문 코스', '중급 코스']);
    expect(courseQuery('INTERMEDIATE')).toBe('intermediate');
    expect(courseOfQuery('intermediate')).toBe('INTERMEDIATE');
    expect(courseOfQuery('beginner')).toBe('BEGINNER');
    expect(courseOfQuery('INTERMEDIATE')).toBeNull();
    expect(courseOfQuery(null)).toBeNull();
    expect(coursePath('INTERMEDIATE')).toBe('/sheet?tab=lessons&course=intermediate');
  });

  it('코스별로 나누고 진도(전체·통과·잠김)를 센다. 앞 코스가 남았으면 뒤 코스는 잠김', () => {
    const ls = both();
    const states = stageStates(ls, new Set());
    expect(lessonsOfCourse(ls, 'INTERMEDIATE').map((l) => l.songId)).toEqual([301, 302]);
    expect(courseProgress(ls, states)).toEqual([
      { course: 'BEGINNER', total: 2, passed: 1, locked: false },
      { course: 'INTERMEDIATE', total: 2, passed: 0, locked: true },
    ]);
    // 레슨이 없는 코스는 빠진다(중급이 등록되기 전 서버)
    const old = list([item(1), item(2)]);
    expect(courseProgress(old, stageStates(old, new Set())).map((p) => p.course)).toEqual(['BEGINNER']);
  });

  it('기본 코스는 도전할 레슨이 있는 코스, 다 통과했으면 마지막 코스', () => {
    const ls = both();
    expect(defaultCourse(ls, stageStates(ls, new Set()))).toBe('BEGINNER');
    expect(defaultCourse(ls, stageStates(ls, new Set([102])))).toBe('INTERMEDIATE');
    expect(defaultCourse(ls, stageStates(ls, new Set([102, 301, 302])))).toBe('INTERMEDIATE');
    expect(defaultCourse([], [])).toBe('BEGINNER');
  });

  it('다음 레슨은 코스 경계를 넘고, 마친 뒤 안내 문구는 같은 코스·다음 코스·끝을 가른다', () => {
    const ls = both();
    expect(nextLesson(ls, 102)?.songId).toBe(301);
    expect(courseFinishText(ls[0], ls[1])).toBe('다음 스테이지가 열렸어요.');
    expect(courseFinishText(ls[1], ls[2])).toBe('입문 코스를 모두 마쳤어요. 중급 코스가 열렸어요.');
    expect(courseFinishText(ls[3], null)).toBe('중급 코스를 모두 마쳤어요.');
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
  it('코스 안에서는 「입문 · 」「중급 · 」 머리말을 뺀다', async () => {
    const { lessonDisplayTitle } = await import('./lesson');
    expect(lessonDisplayTitle('입문 · 킥으로 박자 세기')).toBe('킥으로 박자 세기');
    expect(lessonDisplayTitle('중급 · 탐 필인')).toBe('탐 필인');
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

// 설계 SETUP-학습-코스-자동-넘김 3-1
describe('자동 넘김 판단', () => {
  const ls = list([
    item(1, { kind: 'READ' }),
    item(2),
    item(1, { course: 'INTERMEDIATE', songId: 301, chartId: 401 }),
  ]);

  it('통과했고 다음 레슨이 같은 코스일 때만 다음 레슨을 준다', () => {
    expect(autoAdvanceTarget(ls[0], ls[1], true)?.songId).toBe(102);
    expect(autoAdvanceTarget(ls[0], ls[1], false)).toBeNull();
    // 코스의 마지막 레슨(다음이 다른 코스)·다음이 없음
    expect(autoAdvanceTarget(ls[1], ls[2], true)).toBeNull();
    expect(autoAdvanceTarget(ls[2], null, true)).toBeNull();
  });

  it('자동으로 넘길 때 연주 레슨 주소에는 auto=1이 붙고 알아보기 레슨 주소는 그대로다', () => {
    expect(lessonPath(ls[1], { auto: true })).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1&auto=1');
    expect(lessonPath(ls[1])).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1');
    expect(lessonPath(ls[0], { auto: true })).toBe('/sheet/lesson/101');
  });

  it('카운트다운은 3초이고 안내 문구에 남은 초가 들어간다', () => {
    expect(AUTO_ADVANCE_SECONDS).toBe(3);
    expect(autoAdvanceText(2)).toBe('2초 뒤 다음 레슨으로 넘어가요.');
  });
});

describe('trimLessonTail (연주 레슨 끝의 빈 구간 줄이기, 385 후속)', () => {
  const notes = (...times: number[]) => times.map((timeMs) => ({ timeMs }));

  it('마지막 노트 뒤 LESSON_TAIL_MS까지만 남긴다', () => {
    // 킥으로 박자 세기(70 BPM 2마디): 마지막 킥 6000ms, 서버 곡 길이 9429ms
    const chart = { title: '레슨', durationMs: 9429, notes: notes(0, 857, 6000) };
    const out = trimLessonTail(chart);
    expect(out.durationMs).toBe(6000 + LESSON_TAIL_MS);
    expect(out.title).toBe('레슨');
    expect(out.notes).toBe(chart.notes);
  });

  it('노트 순서와 무관하게 가장 늦은 노트를 기준으로 한다', () => {
    expect(trimLessonTail({ durationMs: 9429, notes: notes(6000, 0, 857) }).durationMs).toBe(6000 + LESSON_TAIL_MS);
  });

  it('이미 짧으면 늘리지 않고 같은 객체를 돌려준다', () => {
    const chart = { durationMs: 6500, notes: notes(0, 6000) };
    expect(trimLessonTail(chart)).toBe(chart);
  });

  it('노트가 없으면 그대로 둔다', () => {
    const chart = { durationMs: 9429, notes: notes() };
    expect(trimLessonTail(chart)).toBe(chart);
  });

  it('원본을 바꾸지 않는다', () => {
    const chart = { durationMs: 9429, notes: notes(6000) };
    trimLessonTail(chart);
    expect(chart.durationMs).toBe(9429);
  });
});
