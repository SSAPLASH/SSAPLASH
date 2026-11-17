// 학습 코스(입문·중급) (SETUP, Jira 331, 설계 SETUP-입문-코스·SETUP-학습-코스-중급). BE `GET /api/v1/lessons` 응답 검증과
// 스테이지 상태·코스 나누기·다음 레슨·통과 판정(순수 함수).
// 잠금은 화면 안내다: 서버 진도에 이번 접속에서 통과한 레슨을 더해 다시 계산한다(업로드가 늦어도 다음 스테이지가 열려 있게).
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { accuracyPercent } from './playUpload';
import { stickConnectionRequired } from '@/domain/kit/device/dockChip';
import { DEVICE_META, deviceGroupName } from '@/domain/kit/device/devices';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';

export type LessonKind = 'READ' | 'PLAY';

/** 학습 코스. 목록은 코스 순서 → 코스 안 순서로 한 줄이고, 잠금은 그 한 줄에서 계산한다(앞 코스를 다 통과해야 다음 코스가 열린다) */
export type LessonCourse = 'BEGINNER' | 'INTERMEDIATE';

export interface CourseMeta {
  key: LessonCourse;
  name: string;
  /** 코스 칸의 한 줄 설명 */
  summary: string;
  /** 주소 `course` 값 */
  query: string;
  /** 스테이지 맵 맨 아래 목표 문구(다 통과 전·후) */
  goal: string;
  reached: string;
  /** 코스 완료 카드 본문(다음 코스가 없을 때) */
  doneText: string;
  /** 앞 코스 완료 카드에서 이 코스를 권하는 문구 */
  invite: string;
}

/** 코스 순서대로(설계 SETUP-학습-코스-중급 3-4) */
export const COURSES: readonly CourseMeta[] = [
  {
    key: 'BEGINNER',
    name: '입문 코스',
    summary: '킥·스네어·하이햇으로 8비트까지',
    query: 'beginner',
    goal: '여기까지 오면 8비트를 칠 수 있어요',
    reached: '8비트를 칠 수 있게 됐어요',
    doneText: '이제 기본 곡의 「기본 8비트」와 쉬운 곡으로 넘어가 보세요.',
    invite: '',
  },
  {
    key: 'INTERMEDIATE',
    name: '중급 코스',
    summary: '크래시·라이드·탐·하이햇 페달로 필인까지',
    query: 'intermediate',
    goal: '여기까지 오면 드럼 아홉 개를 모두 칠 수 있어요',
    reached: '드럼 아홉 개를 모두 칠 수 있게 됐어요',
    doneText: '이제 기본 곡에서 실제 곡을 쳐 보세요.',
    invite: '이제 중급 코스에서 크래시·라이드·탐을 배워 보세요.',
  },
];

const COURSE_INDEX: Record<LessonCourse, number> = { BEGINNER: 0, INTERMEDIATE: 1 };

export function courseMeta(course: LessonCourse): CourseMeta {
  return COURSES[COURSE_INDEX[course]];
}

const isCourse = (v: unknown): v is LessonCourse => v === 'BEGINNER' || v === 'INTERMEDIATE';

export interface Lesson {
  /** 코스 안의 순서(1부터) */
  order: number;
  course: LessonCourse;
  /** READ: 악보가 흐르지 않는 알아보기, PLAY: 악보 연습 화면으로 치는 연주 */
  kind: LessonKind;
  songId: number;
  /** 레슨 채보(NORMAL) */
  chartId: number;
  title: string;
  summary: string;
  pads: PadId[];
  /** 알아보기에서 음표 이름과 드럼을 처음부터 알려 주는가 */
  guide: boolean;
  bpm: number | null;
  durationMs: number | null;
  noteCount: number;
  /** 연주 레슨의 본인 악보 연습 최고 정확도(0~100) */
  bestAccuracy: number | null;
  passed: boolean;
  locked: boolean;
}

export interface LessonList {
  /** 연주 레슨 통과 기준(백분율) */
  passAccuracy: number;
  items: Lesson[];
}

export type StageState = 'passed' | 'open' | 'locked';

const STATE_WORD: Record<StageState, string> = { passed: '통과', open: '도전 가능', locked: '잠김' };

/** 스테이지 상태 한 줄(「연주 · 통과 91.2%」, 「알아보기 · 잠김」) */
export function stageWord(lesson: Pick<Lesson, 'kind' | 'bestAccuracy'>, state: StageState): string {
  const kind = lesson.kind === 'READ' ? '알아보기' : '연주';
  if (state !== 'passed') return `${kind} · ${STATE_WORD[state]}`;
  if (lesson.kind === 'READ' || lesson.bestAccuracy === null) return `${kind} · 통과`;
  return `${kind} · 통과 ${lesson.bestAccuracy.toFixed(1)}%`;
}

/** 화면에 보이는 레슨 제목. 카탈로그 제목의 「입문 · 」「중급 · 」 머리말은 코스 안에서는 뺀다 */
export function lessonDisplayTitle(title: string): string {
  return title.replace(/^(입문|중급)\s*·\s*/, '');
}

/** 악보 연습의 [학습 코스]. 코스는 진도에 맞춰 고른다(defaultCourse) */
export const LESSONS_PATH = '/sheet?tab=lessons';

/** 주소 `course` 값 → 코스. 모르는 값은 null */
export function courseOfQuery(raw: string | null): LessonCourse | null {
  return COURSES.find((c) => c.query === raw)?.key ?? null;
}

export function courseQuery(course: LessonCourse): string {
  return courseMeta(course).query;
}

/** 그 코스를 고른 학습 코스 주소 */
export function coursePath(course: LessonCourse): string {
  return `${LESSONS_PATH}&course=${courseQuery(course)}`;
}

/** 치는 손발(입문자 안내 문구) */
export const PAD_LIMB: Record<PadId, string> = {
  KICK: '오른발',
  HIHAT_PEDAL: '왼발',
  SNARE: '왼손',
  HIHAT: '오른손',
  RIDE: '오른손',
  CRASH: '오른손',
  SMALL_TOM: '오른손',
  MID_TOM: '오른손',
  FLOOR_TOM: '오른손',
};

/** 레슨 카드 음표의 한 줄 음표 수. 카드 폭(약 720px)에 확대 배율 그대로 들어가는 수다 */
const NOTATION_PER_ROW = 4;

/**
 * 레슨 카드 음표를 줄로 나눈다. 4개까지는 한 줄, 넘으면 줄 수를 늘려 고르게 나눈다(앞줄이 같거나 많다: 7 → 4·3).
 * 11/13 로컬 확인: 드럼 7개(중급 「8비트에 필인 넣기」)를 한 줄에 두면 카드에 맞추느라 글자가 너무 작아진다
 */
export function notationRows<T>(items: readonly T[]): T[][] {
  const rows = Math.max(1, Math.ceil(items.length / NOTATION_PER_ROW));
  const size = Math.ceil(items.length / rows);
  return Array.from({ length: rows }, (_, i) => items.slice(i * size, (i + 1) * size));
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPad = (v: unknown): v is PadId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAD_META, v);

function lessonFromDto(d: unknown): Lesson | null {
  if (typeof d !== 'object' || d === null) return null;
  const o = d as Record<string, unknown>;
  if (!isId(o.order) || (o.kind !== 'READ' && o.kind !== 'PLAY') || !isId(o.songId) || !isId(o.chartId)) return null;
  if (typeof o.title !== 'string' || typeof o.summary !== 'string' || typeof o.guide !== 'boolean') return null;
  if (!Array.isArray(o.pads) || o.pads.length === 0 || !o.pads.every(isPad)) return null;
  if (!isNum(o.noteCount) || typeof o.passed !== 'boolean' || typeof o.locked !== 'boolean') return null;
  return {
    order: o.order,
    // 옛 서버 응답(코스 없음)·모르는 값은 입문으로 본다
    course: isCourse(o.course) ? o.course : 'BEGINNER',
    kind: o.kind,
    songId: o.songId,
    chartId: o.chartId,
    title: o.title,
    summary: o.summary,
    pads: [...o.pads],
    guide: o.guide,
    bpm: isNum(o.bpm) ? o.bpm : null,
    durationMs: isNum(o.durationMs) ? o.durationMs : null,
    noteCount: o.noteCount,
    bestAccuracy: isNum(o.bestAccuracy) ? o.bestAccuracy : null,
    passed: o.passed,
    locked: o.locked,
  };
}

/** 형식이 틀린 항목은 빼고 순서대로 정렬한다. 최상위가 틀리면 던진다 */
export function lessonsFromDto(d: unknown): LessonList {
  if (typeof d !== 'object' || d === null) throw new Error('레슨 응답 형식이 올바르지 않습니다.');
  const o = d as Record<string, unknown>;
  if (!isNum(o.passAccuracy) || !Array.isArray(o.items)) throw new Error('레슨 응답 형식이 올바르지 않습니다.');
  const items = o.items.map(lessonFromDto).filter((l): l is Lesson => l !== null);
  items.sort((a, b) => COURSE_INDEX[a.course] - COURSE_INDEX[b.course] || a.order - b.order);
  return { passAccuracy: o.passAccuracy, items };
}

/** 서버 진도 + 이번 접속에서 통과한 레슨(`localPassed`: 곡 id). 통과 전인 첫 레슨만 열고, 그 뒤 통과 전 레슨은 잠김이다 */
export function stageStates(lessons: readonly Lesson[], localPassed: ReadonlySet<number>): StageState[] {
  let blocked = false;
  return lessons.map((l) => {
    const passed = l.passed || localPassed.has(l.songId);
    const state: StageState = passed ? 'passed' : blocked ? 'locked' : 'open';
    if (!passed) blocked = true;
    return state;
  });
}

/** 그 코스의 레슨만 순서대로 */
export function lessonsOfCourse(lessons: readonly Lesson[], course: LessonCourse): Lesson[] {
  return lessons.filter((l) => l.course === course);
}

export interface CourseProgress {
  course: LessonCourse;
  total: number;
  passed: number;
  /** 첫 스테이지부터 잠겨 있다(앞 코스가 남았다) */
  locked: boolean;
}

/** 레슨이 있는 코스마다 진도. `states`는 전체 목록의 stageStates 결과다 */
export function courseProgress(lessons: readonly Lesson[], states: readonly StageState[]): CourseProgress[] {
  return COURSES.flatMap(({ key }) => {
    const idx = lessons.flatMap((l, i) => (l.course === key ? [i] : []));
    if (idx.length === 0) return [];
    return [{ course: key, total: idx.length, passed: idx.filter((i) => states[i] === 'passed').length, locked: idx.every((i) => states[i] === 'locked') }];
  });
}

/** 주소에 코스가 없을 때 보일 코스: 도전할 레슨이 있는 코스. 다 통과했으면 레슨이 있는 마지막 코스 */
export function defaultCourse(lessons: readonly Lesson[], states: readonly StageState[]): LessonCourse {
  const open = states.indexOf('open');
  if (open >= 0) return lessons[open].course;
  return lessons.length > 0 ? lessons[lessons.length - 1].course : 'BEGINNER';
}

/** 레슨을 마친 뒤 안내: 같은 코스면 다음 스테이지, 코스가 바뀌면 다음 코스가 열렸다고, 끝이면 코스를 마쳤다고 */
export function courseFinishText(lesson: Pick<Lesson, 'course'>, next: Pick<Lesson, 'course'> | null): string {
  if (next && next.course === lesson.course) return '다음 스테이지가 열렸어요.';
  const done = `${courseMeta(lesson.course).name}를 모두 마쳤어요.`;
  return next ? `${done} ${courseMeta(next.course).name}가 열렸어요.` : done;
}

export function nextLesson(lessons: readonly Lesson[], songId: number): Lesson | null {
  const i = lessons.findIndex((l) => l.songId === songId);
  return i < 0 || i + 1 >= lessons.length ? null : lessons[i + 1];
}

export function lessonOfChart(lessons: readonly Lesson[], chartId: number | null | undefined): Lesson | undefined {
  return chartId == null ? undefined : lessons.find((l) => l.chartId === chartId);
}

/**
 * 초보 판정 폭 대상: 쉬운(EASY) 채보이거나 학습 코스(입문·중급)의 연주 레슨 채보. 레슨 목록을 아직 못 읽었으면 난이도만 본다
 * (설계 PLAY-004-timing-cal-stick-kick 3-5)
 */
export function isBeginnerChart(i: { difficulty: string | null | undefined; chartId: number | null | undefined; lessons: readonly Lesson[] }): boolean {
  if (i.difficulty === 'EASY') return true;
  return lessonOfChart(i.lessons, i.chartId)?.kind === 'PLAY';
}

/** 연주 레슨에서 마지막 노트 뒤에 남기는 길이(ms). 엔진이 곡 길이 + 0.8초에 끝내므로 마지막 노트 약 2.2초 뒤에 결과로 넘어간다 */
export const LESSON_TAIL_MS = 1400;

/**
 * 연주 레슨 채보의 끝을 당긴다. 서버 곡 길이는 "마지막 노트 + 한 마디"라 짧은 레슨에서는 치는 것 없이 기다리는 구간이 길다(385 후속).
 * 길이만 줄인 새 채보를 돌려주고, 이미 짧거나 노트가 없으면 받은 채보 그대로다. 세션·악보·진행 표시·기록이 이 길이 하나를 쓴다
 */
export function trimLessonTail<T extends { durationMs: number; notes: readonly { timeMs: number }[] }>(chart: T): T {
  if (chart.notes.length === 0) return chart;
  const end = chart.notes.reduce((max, n) => Math.max(max, n.timeMs), 0) + LESSON_TAIL_MS;
  return end < chart.durationMs ? { ...chart, durationMs: end } : chart;
}

/**
 * 레슨을 여는 주소. 연주 레슨은 [학습 코스]와 그 코스를 유지한 악보 연습(시작 확인 창부터, `start=1`) — 곡 고르기로 돌아오면 같은 코스가 보인다.
 * 알아보기는 알아보기 화면. `auto`면 연주 레슨 주소에 `auto=1`을 붙여 시작 확인 창의 플레이까지 자동으로 시작하게 한다(설계 SETUP-학습-코스-자동-넘김 3-3)
 */
export function lessonPath(lesson: Pick<Lesson, 'kind' | 'songId' | 'chartId' | 'course'>, options: { auto?: boolean } = {}): string {
  if (lesson.kind === 'READ') return `/sheet/lesson/${lesson.songId}`;
  return `${coursePath(lesson.course)}&song=${lesson.songId}&chart=${lesson.chartId}&start=1${options.auto ? '&auto=1' : ''}`;
}

/** 통과 뒤 다음 레슨으로 자동으로 넘어가기까지 기다리는 시간(초) */
export const AUTO_ADVANCE_SECONDS = 3;

/**
 * 자동으로 넘길 다음 레슨. 통과했고 다음 레슨이 같은 코스일 때만 준다.
 * 통과하지 못했거나 코스의 마지막 레슨(다음 코스로 넘어가는 경계 포함)은 사용자가 버튼으로 고른다
 */
export function autoAdvanceTarget<T extends Pick<Lesson, 'course'>>(lesson: Pick<Lesson, 'course'>, next: T | null, passed: boolean): T | null {
  return passed && next !== null && next.course === lesson.course ? next : null;
}

/** 카운트다운 안내 한 줄 */
export function autoAdvanceText(remaining: number): string {
  return `${remaining}초 뒤 다음 레슨으로 넘어가요.`;
}

/** 연주 레슨 통과. 서버와 같은 정확도 계산(score / noteCount, 소수 둘째 자리 HALF_UP) */
export function playPassed(result: { score: number; noteCount: number }, passAccuracy: number): boolean {
  if (result.noteCount <= 0) return false;
  return accuracyPercent(result.score, result.noteCount) >= passAccuracy;
}

export interface InviteInput {
  authed: boolean;
  /** 아직 못 받았거나 실패했으면 null */
  lessons: readonly Lesson[] | null;
  localPassed: ReadonlySet<number>;
  dismissed: boolean;
  onLessonsTab: boolean;
}

/** 권유 카드: 로그인, 레슨 1개 이상, 통과한 레슨 0개, 닫은 적 없음, 지금 [입문 코스] 탭이 아님 */
export function shouldInvite(i: InviteInput): boolean {
  if (!i.authed || i.dismissed || i.onLessonsTab || !i.lessons || i.lessons.length === 0) return false;
  return !i.lessons.some((l) => l.passed || i.localPassed.has(l.songId));
}

/** 알아보기 레슨: 채보 노트를 시간 순 패드 줄로. 화면은 시간과 관계없이 이 순서로 한 음표씩 보인다 */
export function readSequence(notes: readonly { timeMs: number; pad: PadId }[]): PadId[] {
  return [...notes].sort((a, b) => a.timeMs - b.timeMs).map((n) => n.pad);
}

export interface ReadStep {
  /** 다음에 칠 음표 위치(끝나면 길이) */
  at: number;
  /** 이번 타격이 지금 음표와 다른 패드였다 */
  miss: boolean;
  done: boolean;
}

/** 알아보기 진행. 맞는 패드면 다음 음표로, 틀리면 그대로. 시간은 보지 않는다 */
export function readStep(seq: readonly PadId[], at: number, pad: PadId): ReadStep {
  if (at >= seq.length) return { at: seq.length, miss: false, done: true };
  if (seq[at] !== pad) return { at, miss: true, done: false };
  return { at: at + 1, miss: false, done: at + 1 >= seq.length };
}

/** 받침이 있으면 「이에요」, 없으면 「예요」 */
function copula(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '이에요' : '예요';
}

/** 「이 음표는 킥이에요. 오른발로 밟아요.」 */
export function noteAnswer(pad: PadId): string {
  const label = PAD_META[pad].label;
  const limb = PAD_LIMB[pad];
  const how = limb.endsWith('발') ? `${limb}로 밟아요` : `${limb}으로 쳐요`;
  return `이 음표는 ${label}${copula(label)}. ${how}.`;
}

/** 알아보기 안내 한 줄. 틀렸으면 답을 알려 주고, guide가 꺼져 있으면 틀리기 전에는 묻기만 한다 */
export function readPrompt(pad: PadId, guide: boolean, miss: boolean): string {
  if (miss) return `다시 볼까요? ${noteAnswer(pad)}`;
  return guide ? noteAnswer(pad) : '이 음표는 어느 드럼일까요? 맞는 드럼을 쳐 보세요.';
}

const FOOT_PADS: ReadonlySet<PadId> = new Set(['KICK', 'HIHAT_PEDAL']);

export interface DeviceHintInput {
  sensorKind: string;
  /** 센서에 사용 안내가 있으면(포인터 모의 IMU 등) 연결 개념이 없다 */
  hasUsageGuide: boolean;
  sticks: readonly [boolean, boolean];
  pedal: readonly [boolean, boolean];
  pads: readonly PadId[];
}

/**
 * 알아보기 화면의 기기 안내. 자유 연습과 같은 스틱 판정(stickConnectionRequired)이고, 동글이면 발로 치는 패드가 있는 레슨만 페달을 본다.
 * 드럼 그림을 눌러도 칠 수 있으므로 막지 않고 안내만 한다
 */
export function readDeviceHint(i: DeviceHintInput): string | null {
  const hands = i.pads.some((p) => !FOOT_PADS.has(p));
  if (hands && stickConnectionRequired(i.sensorKind, i.hasUsageGuide) && !i.sticks[0] && !i.sticks[1]) {
    return `${deviceGroupName(false)}을 연결해 주세요. 아래 드럼 그림을 눌러도 돼요.`;
  }
  if (i.pads.some((p) => FOOT_PADS.has(p)) && pedalRequired(i.sensorKind) && !pedalConnected({ connected: i.pedal })) {
    return `${DEVICE_META.PEDAL.name}을 연결해 주세요. 아래 드럼 그림을 눌러도 돼요.`;
  }
  return null;
}
