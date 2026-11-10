// 입문 코스 (SETUP, Jira 331, 설계 SETUP-입문-코스). BE `GET /api/v1/lessons` 응답 검증과 스테이지 상태·다음 레슨·통과 판정(순수 함수).
// 잠금은 화면 안내다: 서버 진도에 이번 접속에서 통과한 레슨을 더해 다시 계산한다(업로드가 늦어도 다음 스테이지가 열려 있게).
import { PAD_META, type PadId } from './pads';
import { accuracyPercent } from './playUpload';
import { stickConnectionRequired } from './dockChip';
import { pedalConnected, pedalRequired } from './pedalStatus';

export type LessonKind = 'READ' | 'PLAY';

export interface Lesson {
  order: number;
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

/** 화면에 보이는 레슨 제목. 카탈로그 제목의 「입문 · 」 머리말은 코스 안에서는 뺀다 */
export function lessonDisplayTitle(title: string): string {
  return title.replace(/^입문\s*·\s*/, '');
}

/** 악보 연습의 [입문 코스] 탭 */
export const LESSONS_PATH = '/sheet?tab=lessons';

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
  items.sort((a, b) => a.order - b.order);
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

export function nextLesson(lessons: readonly Lesson[], songId: number): Lesson | null {
  const i = lessons.findIndex((l) => l.songId === songId);
  return i < 0 || i + 1 >= lessons.length ? null : lessons[i + 1];
}

export function lessonOfChart(lessons: readonly Lesson[], chartId: number | null | undefined): Lesson | undefined {
  return chartId == null ? undefined : lessons.find((l) => l.chartId === chartId);
}

/** 레슨을 여는 주소. 연주 레슨은 [입문 코스] 탭을 유지한 악보 연습(연주 준비부터), 알아보기는 알아보기 화면 */
export function lessonPath(lesson: Pick<Lesson, 'kind' | 'songId' | 'chartId'>): string {
  return lesson.kind === 'READ' ? `/sheet/lesson/${lesson.songId}` : `${LESSONS_PATH}&song=${lesson.songId}&chart=${lesson.chartId}`;
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
    return '스틱이 연결되지 않았어요. 아래 드럼 그림을 눌러도 돼요.';
  }
  if (i.pads.some((p) => FOOT_PADS.has(p)) && pedalRequired(i.sensorKind) && !pedalConnected({ connected: i.pedal })) {
    return '페달이 연결되지 않았어요. 아래 드럼 그림을 눌러도 돼요.';
  }
  return null;
}
