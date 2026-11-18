// 채보. 공통 명세서 9-2.
import type { PadId } from '@/domain/kit/pads';

export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';
export type ChartSource = 'BUILTIN' | 'MIDI' | 'AUDIO' | 'MUSICXML';

export interface ChartNote {
  timeMs: number;
  pad: PadId;
  hihatOpen?: true;
  /** 0~127, 선택 */
  velocityHint?: number;
  /** BE 채보의 노트 id(업로드 matchedNoteId). 내장 채보는 미설정 */
  noteId?: string;
  /** 연습 속도로 늘린 채보에서만: 늘리기 전 원래 시각(ms). 기록은 이 값으로 남긴다(domain/song/practiceRate) */
  sourceTimeMs?: number;
}

/** 빠르기 구간. beat는 1마디 1박을 0으로 센 박 번호, startMs는 곡 시각(반주 0초 기준) */
export interface TempoSegment {
  beat: number;
  startMs: number;
  bpm: number;
}

export interface Chart {
  songId: string;
  title: string;
  difficulty: Difficulty;
  bpm: number;
  /** 음원 시작 오프셋. 반주 없는 내장 채보는 0 */
  offsetMs: number;
  /** 박자표 분자 (카운트인·마디선용) */
  beatsPerBar: number;
  notes: ChartNote[];
  source: ChartSource;
  durationMs: number;
  /** BE 채보의 버전 id. 플레이 시작 후 고정한다. 내장 채보는 미설정 */
  chartVersionId?: number;
  /** BE 채보 id(`/play?chart=`에 쓰는 값). 내장 채보는 미설정 */
  chartId?: number;
  /** BE 곡 id(숫자). `songId`(string)와 별개. 내장 채보는 미설정 */
  songNumericId?: number;
  /** 반주 음원이 있는 곡인지. 내장 채보는 미설정(없음) */
  hasAccompaniment?: boolean;
  /** 템포·박자 변화가 있는 곡. 악보 화면은 고정 bpm으로 그린다(1단계 미지원) */
  variableTempo?: boolean;
  /** 빠르기 구간(둘 이상일 때만). 메트로놈 클릭·연주 화면 마디선이 따른다. 첫 구간 startMs = offsetMs */
  tempoSegments?: TempoSegment[];
  /** BE 채보의 전체 노트 수. 변환에서 버린 노트가 있으면 notes.length와 다르다. 내장 채보는 미설정 */
  sourceNoteCount?: number;
  /** 연습 속도 배율(0.5~1). 늘린 채보에만 있다. 없으면 1(원래 빠르기) */
  playbackRate?: number;
  /** 늘리기 전 원래 채보의 길이·빠르기·원점. 늘린 채보에만 있다. 기록(로그)은 이 값으로 남긴다 */
  sourceTiming?: { durationMs: number; bpm: number; offsetMs: number };
}

/* ---------- 내장 데모 채보 생성기 ----------
 * 0단계용. 반주 없이 패턴을 코드로 만든다. CHART-01 라이브러리가 오면 교체.
 */

type Step = Partial<Record<PadId, number>>; // 16분음표 한 칸에 칠 패드와 세기

function pattern(
  bars: number,
  bpm: number,
  stepsPerBar: number,
  barFn: (bar: number) => Step[],
): ChartNote[] {
  const stepMs = (60_000 / bpm) * (4 / stepsPerBar);
  const notes: ChartNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const steps = barFn(bar);
    steps.forEach((step, i) => {
      const t = Math.round((bar * stepsPerBar + i) * stepMs);
      for (const [pad, vel] of Object.entries(step) as [PadId, number][]) {
        notes.push({ timeMs: t, pad, velocityHint: vel });
      }
    });
  }
  return notes.sort((a, b) => a.timeMs - b.timeMs);
}

function make(
  songId: string,
  title: string,
  difficulty: Difficulty,
  bpm: number,
  bars: number,
  stepsPerBar: number,
  barFn: (bar: number) => Step[],
): Chart {
  const notes = pattern(bars, bpm, stepsPerBar, barFn);
  const barMs = (60_000 / bpm) * 4;
  return {
    songId,
    title,
    difficulty,
    bpm,
    offsetMs: 0,
    beatsPerBar: 4,
    notes,
    source: 'BUILTIN',
    durationMs: Math.round(bars * barMs),
  };
}

/** 하이햇 8비트 + 스네어 2·4박. 처음 쳐보는 사람용 */
export const CHART_BASIC_8: Chart = make('demo-8beat', '기본 8비트', 'EASY', 90, 8, 8, () => [
  { HIHAT: 100, KICK: 110 },
  { HIHAT: 70 },
  { HIHAT: 90, SNARE: 110 },
  { HIHAT: 70 },
  { HIHAT: 100, KICK: 110 },
  { HIHAT: 70 },
  { HIHAT: 90, SNARE: 110 },
  { HIHAT: 70 },
]);

/** 8비트 + 4마디마다 탐 필인 */
export const CHART_8_FILL: Chart = make('demo-8beat-fill', '8비트 + 필인', 'NORMAL', 100, 8, 16, (bar) => {
  const groove: Step[] = [];
  for (let i = 0; i < 16; i++) {
    const s: Step = {};
    if (i % 2 === 0) s.HIHAT = i % 4 === 0 ? 100 : 75;
    if (i === 0 || i === 8) s.KICK = 110;
    if (i === 4 || i === 12) s.SNARE = 110;
    if (i === 10) s.KICK = 95;
    groove.push(s);
  }
  if (bar % 4 === 3) {
    // 마지막 반 마디 필인: 스네어 → 스몰탐 → 플로어탐 → 크래시
    groove[8] = { SNARE: 100 };
    groove[9] = { SNARE: 90 };
    groove[10] = { SMALL_TOM: 100 };
    groove[11] = { SMALL_TOM: 90 };
    groove[12] = { FLOOR_TOM: 105 };
    groove[13] = { FLOOR_TOM: 95 };
    groove[14] = { FLOOR_TOM: 110 };
    groove[15] = {};
  }
  if (bar % 4 === 0 && bar > 0) groove[0] = { CRASH: 115, KICK: 110 };
  return groove;
});

/** 라이드 패턴 + 고스트 노트. 빠른 편 */
export const CHART_RIDE_16: Chart = make('demo-ride-16', '라이드 16비트', 'HARD', 120, 8, 16, (bar) => {
  const g: Step[] = [];
  for (let i = 0; i < 16; i++) {
    const s: Step = {};
    if (i % 2 === 0) s.RIDE = i % 4 === 0 ? 100 : 80;
    if (i === 0 || i === 6 || i === 8 || i === 14) s.KICK = 110;
    if (i === 4 || i === 12) s.SNARE = 115;
    if (i === 7 || i === 15) s.SNARE = 45; // 고스트
    g.push(s);
  }
  if (bar % 2 === 1) {
    g[13] = { SMALL_TOM: 95 };
    g[14] = { FLOOR_TOM: 100 };
    g[15] = { CRASH: 110 };
  }
  return g;
});

export const BUILTIN_CHARTS: Chart[] = [CHART_BASIC_8, CHART_8_FILL, CHART_RIDE_16];

/** 내장 채보 인덱스 → 곡·채보 공용 음수 id */
export const builtinId = (index: number): number => -(index + 1);
