// @vitest-environment happy-dom
// SightGamePage 검증(설계 MODE-006-minigame-sight 4절): 가짜 타이머로 한 판을 끝까지 돌린다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
// 난수는 0으로 고정한다(대기 간격이 늘 1000ms). 어떤 문제가 나오는지는 예측하지 않고 오선의 음표(data-pad)에서 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ResolvedHit } from '@/domain/events';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { parseRecords, serializeRecords, type MiniRecord, type MiniRecords } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { SightGamePage } from '@/features/mini/SightGamePage';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn() }));
vi.mock('@/runtime/hitSound', () => ({ setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));
vi.mock('@/components/drum/LiveDrumKit', () => ({
  LiveDrumKit: (props: { labels?: boolean; lit?: string }) => (
    <div data-testid="kit" data-labels={String(Boolean(props.labels))} data-lit={props.lit ?? ''} />
  ),
}));
vi.mock('@/components/drum/usePadStates', () => ({ usePadStates: () => ({}), usePadHitSeq: () => ({}) }));

const STORAGE_KEY = 'ssaplash.mini.v1';
const HINT_KEY = 'ssaplash.mini.sightHint.v1';
const SEED_AT = '2026-11-01T09:00:00.000Z';
const KICK_NOTE = '킥 페달이 연결돼 있지 않아 킥은 빼고 낼게요.';
const PROMPT = '이 음표의 패드를 치세요.';
const WRONG_TEXT = '틀렸어요. 0.5초가 더해졌어요.';
const EARLY_TEXT = '아직이에요. 음표가 뜬 뒤에 치세요.';

let nextId = 1;
let randomSpy: MockInstance<() => number>;
let originalSensorKind: string;

const name = (pad: PadId) => PAD_META[pad].label;

function problems(score: number): MiniRecord & { gameId: 'sight' } {
  return {
    gameId: 'sight',
    variant: 'hint-on',
    score,
    at: SEED_AT,
    detail: { problems: Array.from({ length: 10 }, () => ({ pad: 'SNARE' as PadId, ms: score, wrongs: 0, timedOut: false })) },
  };
}

function sightRecord(variant: 'hint-on' | 'hint-off', score: number): MiniRecord {
  return { ...problems(score), variant };
}

/** 저장소에 기록을 심는다(화면이 열릴 때 읽는다) */
function seed(records: MiniRecords) {
  localStorage.setItem(STORAGE_KEY, serializeRecords(records));
}

function seedSight(variant: 'hint-on' | 'hint-off', score: number) {
  seed({ [`sight:${variant}`]: sightRecord(variant, score) });
}

function stored(): MiniRecords {
  return parseRecords(localStorage.getItem(STORAGE_KEY));
}

/** 타격 한 번을 실제 앱과 같은 길로 넣는다 */
function emit(over: { id?: number; pad?: PadId | null; tHit: number; tRecv?: number }) {
  const hit = {
    id: over.id ?? nextId++,
    stickId: null,
    pad: over.pad === undefined ? 'SNARE' : over.pad,
    source: 'keyboard',
    velocity: 100,
    tHit: over.tHit,
    tRecv: over.tRecv ?? over.tHit,
  } as unknown as ResolvedHit;
  act(() => {
    useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function open() {
  return render(
    <MemoryRouter initialEntries={['/play/mini/sight']}>
      <Routes>
        <Route path="/play/mini/sight" element={<SightGamePage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const startButton = () => screen.getByRole('button', { name: '시작하기' });
const clickStart = () => fireEvent.click(startButton());
const clickQuit = () => fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
const retryButton = () => screen.getByRole('button', { name: '다시 하기' });
const clickRetry = () => fireEvent.click(retryButton());
const text = (id: string) => screen.getByTestId(id).textContent;
const message = () => screen.getByTestId('mini-sight-message');
const count = () => text('mini-sight-count');
const clock = () => text('mini-sight-clock');
const clockBox = () => document.querySelector('.mini-sight-clock') as HTMLElement;
const countdownValue = () => document.querySelector('.play-countdown-value')?.textContent ?? null;
const introShown = () => screen.queryByText('음표가 뜨면') !== null;
const kit = () => screen.getByTestId('kit');
const staffLabel = () => document.querySelector('.lesson-solo-staff svg')?.getAttribute('aria-label') ?? null;
const radio = (label: string) => screen.getByRole('radio', { name: label }) as HTMLButtonElement;
const dots = () => Array.from(document.querySelectorAll('.mini-sight-dot')).map((el) => el.getAttribute('data-state'));
const lastActive = () => vi.mocked(useKeyboardDrum).mock.calls.at(-1)?.[0];

/** 오선에 그려진 음표의 패드. 음표가 없으면 null */
function notePad(): PadId | null {
  return (document.querySelector('.lesson-solo-note')?.getAttribute('data-pad') as PadId | null) ?? null;
}

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 안내의 숫자 칸과 플레이 화면의 값 캡슐을 같이 찾는다. 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label, .mini-sight-stat dt'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}
/** 플레이 화면 머리 줄의 보조 글(「힌트 끔 · 10문제」) */
const stageSub = () => screen.getByTestId('mini-sight-sub').textContent;

const rowPads = () => Array.from(document.querySelectorAll('.mini-sight-row-pad')).map((el) => el.textContent);

/** 시작 → 카운트다운 3초 */
function toPlaying() {
  clickStart();
  advance(3000);
}

interface Shown {
  pad: PadId;
  /** 음표를 그린 프레임의 시각(performance.now 축) */
  paintedAt: number;
}

/**
 * 대기가 끝나 음표가 뜨고 그 프레임이 지날 때까지 흘린다. 프레임은 가짜 rAF라 1ms씩 흘리며
 * 시계가 흐르기 시작한 순간(= 제시 시각)을 잡는다
 */
function showNote(wait = 1000): Shown {
  advance(wait);
  expect(notePad()).not.toBeNull();
  for (let i = 0; i < 40 && !clockBox().classList.contains('is-running'); i += 1) advance(1);
  expect(clockBox().classList.contains('is-running')).toBe(true);
  return { pad: notePad() as PadId, paintedAt: performance.now() };
}

/** 제시 시각으로부터 ms 뒤의 타격 시각까지 시계를 흘리고 그 시각을 돌려준다 */
function advanceTo(shown: Shown, ms: number): number {
  const target = shown.paintedAt + ms;
  const left = target - performance.now();
  if (left > 0) advance(left);
  return target;
}

/** 제시 시각 ms 뒤에 패드를 친다(기본은 맞는 패드) */
function answer(shown: Shown, ms: number, pad: PadId | null = shown.pad) {
  emit({ pad, tHit: advanceTo(shown, ms) });
}

const wrongPadFor = (pad: PadId): PadId => (pad === 'SNARE' ? 'HIHAT' : 'SNARE');

/** 확인(0.8초)을 지나 다음 문제의 대기로 */
function finishProblem() {
  advance(800);
}

type Step = number | 'timeout' | { ms: number; wrongs: number };

/** 문제 하나를 풀고 확인까지 지나간다. 낸 패드를 돌려준다 */
function playProblem(step: Step): PadId {
  const shown = showNote();
  if (step === 'timeout') {
    advance(5000);
  } else if (typeof step === 'number') {
    answer(shown, step);
  } else {
    // 틀린 타격은 0.1초 뒤에 친다(그 안이면 미리 친 것이 된다)
    for (let i = 0; i < step.wrongs; i += 1) answer(shown, 100 + i, wrongPadFor(shown.pad));
    answer(shown, step.ms);
  }
  finishProblem();
  return shown.pad;
}

/** 문제들을 차례로 푼다. 낸 패드 목록을 돌려준다 */
function playProblems(steps: readonly Step[]): PadId[] {
  return steps.map(playProblem);
}

/** 한 판을 끝까지: 시작 → 카운트다운 → 문제 → 결과 화면. 낸 패드(낸 순서)를 돌려준다 */
function playRound(steps: readonly Step[]): PadId[] {
  toPlaying();
  return playProblems(steps);
}

const ten = (ms: number): Step[] => Array.from({ length: 10 }, () => ms);

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 1;
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
  useMiniRecords.setState({ owner: null, records: {} });
  originalSensorKind = useSettings.getState().sensorKind;
  useSettings.setState({ sensorKind: 'none' });
  useLive.setState({
    connected: [true, false],
    pedal: { ...useLive.getState().pedal, connected: [false, false] },
    lastHit: null,
    hitSeq: 0,
  });
  vi.mocked(unlockAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSoundOnHit).mockReset();
  vi.mocked(useKeyboardDrum).mockReset();
});

afterEach(() => {
  cleanup();
  randomSpy.mockRestore();
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useSettings.setState({ sensorKind: originalSensorKind });
  useLive.setState({
    connected: [false, false],
    pedal: { ...useLive.getState().pedal, connected: [false, false] },
    lastHit: null,
    hitSeq: 0,
  });
});

describe('안내 단계', () => {
  it('열면 안내 단계다: 위 작은 글·제목 두 줄·칸 세 개', () => {
    open();
    expect(document.querySelector('.mini-overline')?.textContent).toBe('악보 보고 빨리 치기');
    expect(screen.getByText('음표가 뜨면')).toBeTruthy();
    expect(screen.getByText('맞는 패드를 바로 치세요.')).toBeTruthy();
    expect(cell('한 판')).toContain('10');
    expect(cell('한 판')).toContain('문제');
    expect(cell('재는 것')).toContain('평균 반응');
    expect(cell('내 최고 기록')).toContain('—');
    expect(document.querySelectorAll('.mini-cell')).toHaveLength(3);
    expect(screen.queryByTestId('mini-sight-count')).toBeNull();
  });

  it('힌트는 저장된 것이 없으면 「힌트 켬」이다', () => {
    open();
    expect(screen.getByRole('radiogroup', { name: '힌트' })).toBeTruthy();
    expect(radio('힌트 켬').getAttribute('aria-checked')).toBe('true');
    expect(radio('힌트 끔').getAttribute('aria-checked')).toBe('false');
  });

  it('저장된 힌트 값이 끔이면 「힌트 끔」으로 시작한다', () => {
    localStorage.setItem(HINT_KEY, 'off');
    open();
    expect(radio('힌트 끔').getAttribute('aria-checked')).toBe('true');
    expect(radio('힌트 켬').getAttribute('aria-checked')).toBe('false');
  });

  it('다른 옵션을 누르면 고른 값이 저장된다', () => {
    open();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
    fireEvent.click(radio('힌트 끔'));
    expect(radio('힌트 끔').getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem(HINT_KEY)).toBe('off');
    fireEvent.click(radio('힌트 켬'));
    expect(localStorage.getItem(HINT_KEY)).toBe('on');
  });

  it('내 최고 기록 칸은 고른 힌트의 기록을 따라간다', () => {
    seed({ 'sight:hint-on': sightRecord('hint-on', 420), 'sight:hint-off': sightRecord('hint-off', 610) });
    open();
    const on = cell('내 최고 기록');
    expect(on).toContain('0.42');
    expect(on).toContain('초');
    expect(on).toContain('힌트 켬 기록이에요');
    fireEvent.click(radio('힌트 끔'));
    const off = cell('내 최고 기록');
    expect(off).toContain('0.61');
    expect(off).toContain('힌트 끔 기록이에요');
    expect(off).not.toContain('0.42');
  });

  it('선택한 힌트의 기록만 없으면 그 칸만 「—」이다', () => {
    seedSight('hint-on', 420);
    open();
    fireEvent.click(radio('힌트 끔'));
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('동글(webserial)에 킥 페달이 없으면 안내가 보이고 킥은 나오지 않는다', () => {
    useSettings.setState({ sensorKind: 'webserial' });
    open();
    expect(screen.getByText(KICK_NOTE)).toBeTruthy();
    const pads = playRound(ten(400));
    expect(pads).toHaveLength(10);
    expect(pads).not.toContain('KICK');
    expect(new Set(pads).size).toBe(7);
  });

  it('동글에 킥 페달이 연결돼 있으면 안내가 없고 킥도 나온다', () => {
    useSettings.setState({ sensorKind: 'webserial' });
    useLive.setState({ pedal: { ...useLive.getState().pedal, connected: [true, true] } });
    open();
    expect(screen.queryByText(KICK_NOTE)).toBeNull();
    expect(playRound(ten(400))).toContain('KICK');
  });

  it('키보드 전용(none)이면 안내가 없고 킥도 나온다', () => {
    open();
    expect(screen.queryByText(KICK_NOTE)).toBeNull();
    const pads = playRound(ten(400));
    expect(pads).toContain('KICK');
    expect(new Set(pads).size).toBe(8);
  });

  it('스틱이 연결돼 있지 않으면 안내가 보이되 시작할 수 있다', () => {
    useLive.setState({ connected: [false, false] });
    open();
    expect(screen.getByText('스틱이 연결돼 있지 않아요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '드럼 세팅' })).toBeTruthy();
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
    clickStart();
    expect(countdownValue()).toBe('3');
  });

  it('스틱이 연결돼 있으면 연결 안내가 없다', () => {
    open();
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
  });

  it('[시작하기]는 오디오 잠금을 풀고, 풀지 못해도 판은 시작한다', async () => {
    open();
    expect(unlockAudio).not.toHaveBeenCalled();
    clickStart();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    cleanup();

    vi.mocked(unlockAudio).mockRejectedValue(new Error('blocked'));
    open();
    clickStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(countdownValue()).toBe('3');
  });

  it('화면에 있는 동안 타격음이 켜지고 떠나면 꺼진다', () => {
    const { unmount } = open();
    expect(vi.mocked(setSoundOnHit).mock.calls).toEqual([[true]]);
    unmount();
    expect(vi.mocked(setSoundOnHit).mock.calls.at(-1)).toEqual([false]);
  });
});

describe('카운트다운과 대기', () => {
  it('3 → 2 → 1 뒤에 플레이가 되고, 뒤에는 문제 판이 깔려 있다', () => {
    open();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    expect(message().classList.contains('is-plain')).toBe(true);
    expect(notePad()).toBeNull();
    expect(count()).toBe('1 / 10');
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(999);
    expect(countdownValue()).toBe('1');
    advance(1);
    expect(countdownValue()).toBeNull();
    expect(screen.getByRole('button', { name: '그만하기' })).toBeTruthy();
  });

  it('카운트다운 중의 타격은 아무것도 바꾸지 않는다', () => {
    open();
    clickStart();
    advance(1500);
    emit({ tHit: performance.now() });
    emit({ pad: 'HIHAT', tHit: performance.now() });
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    expect(message().classList.contains('is-plain')).toBe(true);
    advance(1500);
    expect(count()).toBe('1 / 10');
    expect(cell('틀림')).toContain('0번');
    // 플레이가 시작돼도 첫 문제는 그대로 기다리는 중이다
    expect(message().classList.contains('is-bad')).toBe(false);
    const shown = showNote();
    answer(shown, 300);
    expect(clock()).toBe('0.30');
    expect(dots()[0]).toBe('ok');
  });

  it('대기 1000ms 동안 음표가 없다가 1000ms에 뜬다', () => {
    open();
    toPlaying();
    expect(notePad()).toBeNull();
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    advance(999);
    expect(document.querySelector('.lesson-solo-note')).toBeNull();
    advance(1);
    expect(document.querySelector('.lesson-solo-note')).not.toBeNull();
    expect(message().textContent).toBe(PROMPT);
  });

  it('대기 중에 치면 「아직이에요」가 뜨고 새 대기가 시작된다', () => {
    open();
    toPlaying();
    advance(500);
    emit({ tHit: performance.now() });
    expect(message().textContent).toBe(EARLY_TEXT);
    expect(message().classList.contains('is-bad')).toBe(true);
    expect(count()).toBe('1 / 10');
    // 원래 대기(500ms 남음)는 버려지고 친 때부터 새로 1000ms를 잰다
    advance(999);
    expect(notePad()).toBeNull();
    advance(1);
    expect(notePad()).not.toBeNull();
  });

  it('「아직이에요」는 1500ms 뒤 대기 중이면 사라진다', () => {
    open();
    clickStart();
    advance(2000);
    randomSpy.mockReturnValue(0.999);
    advance(1000);
    emit({ tHit: performance.now() });
    expect(message().textContent).toBe(EARLY_TEXT);
    // 새 대기는 난수 0.999라 2499ms다
    advance(1499);
    expect(message().textContent).toBe(EARLY_TEXT);
    advance(1);
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    expect(message().classList.contains('is-plain')).toBe(true);
    expect(notePad()).toBeNull();
  });

  it('음표가 DOM에 있어도 그리는 프레임이 지나기 전의 타격은 미리 친 것이다', () => {
    open();
    toPlaying();
    advance(1000);
    expect(notePad()).not.toBeNull();
    emit({ tHit: performance.now() });
    expect(message().textContent).toBe(EARLY_TEXT);
    expect(notePad()).toBeNull();
    expect(count()).toBe('1 / 10');
  });

  it('음표가 뜬 지 99ms 뒤의 타격은 미리 친 것이다', () => {
    open();
    toPlaying();
    const shown = showNote();
    answer(shown, 99);
    expect(message().textContent).toBe(EARLY_TEXT);
    expect(notePad()).toBeNull();
    expect(dots()[0]).toBe('now');
    expect(cell('틀림')).toContain('0번');
  });

  it('100ms 뒤에 맞는 패드를 치면 맞힌 것이다', () => {
    open();
    toPlaying();
    const shown = showNote();
    answer(shown, 100);
    expect(message().textContent).toBe(`${name(shown.pad)}, 맞았어요.`);
    expect(clock()).toBe('0.10');
    expect(dots()[0]).toBe('ok');
  });
});

describe('답하기', () => {
  it('맞히면 시계가 그 시간에서 멈추고 점이 채워지고 평균 칸이 바뀐다', () => {
    open();
    toPlaying();
    const shown = showNote();
    expect(count()).toBe('1 / 10');
    answer(shown, 380);
    expect(message().textContent).toBe(`${name(shown.pad)}, 맞았어요.`);
    expect(message().classList.contains('is-good')).toBe(true);
    expect(clock()).toBe('0.38');
    expect(clockBox().classList.contains('is-frozen')).toBe(true);
    expect(dots()[0]).toBe('ok');
    expect(dots()[1]).toBe('now');
    const average = cell('지금까지 평균');
    expect(average).toContain('0.38');
    expect(average).toContain('초');
    // 확인 0.8초 뒤 다음 문제의 대기가 시작된다
    expect(count()).toBe('2 / 10');
    advance(799);
    expect(message().classList.contains('is-good')).toBe(true);
    advance(1);
    expect(notePad()).toBeNull();
    expect(count()).toBe('2 / 10');
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    advance(999);
    expect(notePad()).toBeNull();
    advance(1);
    expect(notePad()).not.toBeNull();
  });

  it('틀린 패드를 치면 0.5초가 더해지고 문제는 이어진다', () => {
    open();
    toPlaying();
    const shown = showNote();
    expect(cell('틀림')).toContain('0번');
    answer(shown, 100, wrongPadFor(shown.pad));
    expect(message().textContent).toBe(WRONG_TEXT);
    expect(message().classList.contains('is-bad')).toBe(true);
    expect(cell('틀림')).toContain('1번');
    expect(notePad()).toBe(shown.pad);
    expect(count()).toBe('1 / 10');
    answer(shown, 700);
    expect(clock()).toBe('1.20');
    expect(clockBox().classList.contains('is-frozen')).toBe(true);
    expect(dots()[0]).toBe('bad');
    // 확인 중에는 끝난 문제에 이미 들어 있어서 두 번 세지 않는다
    expect(cell('틀림')).toContain('1번');
    expect(cell('지금까지 평균')).toContain('1.20');
  });

  it('「틀렸어요」는 1500ms 뒤 아직 못 맞혔으면 처음 문구로 돌아온다', () => {
    open();
    toPlaying();
    const shown = showNote();
    answer(shown, 100, wrongPadFor(shown.pad));
    expect(message().textContent).toBe(WRONG_TEXT);
    advance(1499);
    expect(message().textContent).toBe(WRONG_TEXT);
    advance(1);
    expect(message().textContent).toBe(PROMPT);
    expect(message().classList.contains('is-plain')).toBe(true);
    // 틀린 횟수는 그대로 남는다
    expect(cell('틀림')).toContain('1번');
  });

  it('패드를 판정하지 못한 타격(pad: null)은 대기·제시 중 모두 아무 일도 없다', () => {
    open();
    toPlaying();
    advance(500);
    emit({ pad: null, tHit: performance.now() });
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    expect(message().classList.contains('is-bad')).toBe(false);
    // 대기가 다시 시작되지 않았다: 처음 대기가 끝나는 500ms 뒤에 음표가 뜬다
    advance(500);
    expect(notePad()).not.toBeNull();
    const shown = showNote(0);
    answer(shown, 300, null);
    expect(message().textContent).toBe(PROMPT);
    expect(cell('틀림')).toContain('0번');
    expect(dots()[0]).toBe('now');
    // 이어서 맞히면 제시 시각부터 잰다
    answer(shown, 450);
    expect(clock()).toBe('0.45');
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    toPlaying();
    const shown = showNote();
    const at = advanceTo(shown, 200);
    emit({ id: 900, pad: wrongPadFor(shown.pad), tHit: at });
    emit({ id: 900, pad: wrongPadFor(shown.pad), tHit: at });
    expect(cell('틀림')).toContain('1번');
    emit({ id: 901, pad: wrongPadFor(shown.pad), tHit: at });
    expect(cell('틀림')).toContain('2번');
  });

  it('확인 중의 타격은 받지 않는다(미리 친 것으로도 세지 않고 다음 문제가 정상으로 흐른다)', () => {
    open();
    toPlaying();
    const first = showNote();
    answer(first, 300);
    advance(200);
    emit({ tHit: performance.now() });
    expect(message().textContent).toBe(`${name(first.pad)}, 맞았어요.`);
    expect(message().classList.contains('is-good')).toBe(true);
    advance(600);
    expect(notePad()).toBeNull();
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    const second = showNote(1000);
    answer(second, 350);
    expect(clock()).toBe('0.35');
    expect(dots().slice(0, 2)).toEqual(['ok', 'ok']);
  });

  it('5초 안에 못 치면 시간 초과로 끝나고 판은 이어진다', () => {
    open();
    toPlaying();
    const shown = showNote();
    advance(4999);
    expect(message().textContent).toBe(PROMPT);
    advance(1);
    expect(message().textContent?.startsWith('시간이 다 됐어요.')).toBe(true);
    expect(message().textContent).toContain(name(shown.pad));
    expect(message().classList.contains('is-bad')).toBe(true);
    expect(clock()).toBe('5.00');
    expect(clockBox().classList.contains('is-frozen')).toBe(true);
    expect(dots()[0]).toBe('bad');
    expect(count()).toBe('2 / 10');
    finishProblem();
    expect(notePad()).toBeNull();
    const next = showNote();
    answer(next, 400);
    expect(clock()).toBe('0.40');
  });

  it('시계는 음표가 뜬 뒤 흐르고, 틀리면 0.5초가 한꺼번에 더해진다', () => {
    open();
    toPlaying();
    const shown = showNote();
    expect(clock()).toBe('0.00');
    advance(300);
    const before = Number(clock());
    expect(before).toBeGreaterThanOrEqual(0.28);
    expect(before).toBeLessThanOrEqual(0.3);
    emit({ pad: wrongPadFor(shown.pad), tHit: performance.now() });
    advance(16);
    const after = Number(clock());
    expect(after).toBeGreaterThanOrEqual(before + 0.5);
    expect(after).toBeLessThanOrEqual(before + 0.5 + 0.04);
    expect(clockBox().classList.contains('is-running')).toBe(true);
  });
});

describe('힌트', () => {
  it('힌트 켬: 제시 중에 이름·악보 이름·드럼 라벨과 불빛이 보인다', () => {
    open();
    toPlaying();
    expect(kit().getAttribute('data-labels')).toBe('true');
    expect(kit().getAttribute('data-lit')).toBe('');
    expect(text('mini-sight-hint')).toBe('');
    expect(staffLabel()).toBe('빈 오선');
    const shown = showNote();
    expect(text('mini-sight-hint')).toBe(name(shown.pad));
    expect(staffLabel()).toBe(`${name(shown.pad)} 음표`);
    expect(kit().getAttribute('data-labels')).toBe('true');
    expect(kit().getAttribute('data-lit')).toBe(shown.pad);
    // 맞히면 불빛은 꺼진다
    answer(shown, 300);
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('힌트 끔: 제시 중에는 이름이 비고 악보 이름은 「음표」, 확인 중에 이름이 나온다', () => {
    localStorage.setItem(HINT_KEY, 'off');
    open();
    toPlaying();
    const shown = showNote();
    expect(text('mini-sight-hint')).toBe('');
    expect(staffLabel()).toBe('음표');
    expect(kit().getAttribute('data-labels')).toBe('false');
    expect(kit().getAttribute('data-lit')).toBe('');
    answer(shown, 300);
    expect(text('mini-sight-hint')).toBe(name(shown.pad));
    expect(staffLabel()).toBe(`${name(shown.pad)} 음표`);
    expect(message().textContent).toBe(`${name(shown.pad)}, 맞았어요.`);
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('한 판 중에는 힌트를 바꿀 조작이 없고 머리 줄이 안내에서 고른 값을 보인다', () => {
    open();
    fireEvent.click(radio('힌트 끔'));
    clickStart();
    for (const phase of ['countdown', 'playing']) {
      expect(screen.queryByRole('radio')).toBeNull();
      expect(stageSub()).toBe('힌트 끔 · 10문제');
      if (phase === 'countdown') advance(3000);
    }
    expect(localStorage.getItem(HINT_KEY)).toBe('off');
  });
});

describe('한 판의 끝과 결과', () => {
  it('열 번째 문제를 맞히면 마무리에 들어가 타격을 받지 않고 0.8초 뒤 결과가 뜬다', () => {
    open();
    toPlaying();
    playProblems(Array<Step>(9).fill(400));
    expect(count()).toBe('10 / 10');
    const last = showNote();
    answer(last, 400);
    expect(lastActive()).toBe(false);
    expect(count()).toBe('10 / 10');
    expect(dots().every((s) => s === 'ok')).toBe(true);
    emit({ tHit: performance.now() });
    emit({ pad: 'HIHAT', tHit: performance.now() });
    expect(message().textContent).toBe(`${name(last.pad)}, 맞았어요.`);
    expect(message().classList.contains('is-good')).toBe(true);
    advance(799);
    expect(screen.queryByTestId('mini-sight-count')).not.toBeNull();
    // 열한 번째 음표는 없다
    expect(notePad()).toBe(last.pad);
    advance(1);
    expect(screen.queryByTestId('mini-sight-count')).toBeNull();
    expect(retryButton()).toBeTruthy();
    expect(lastActive()).toBe(false);
    advance(10_000);
    expect(retryButton()).toBeTruthy();
  });

  it('전부 400ms에 맞히면 평균 0.40초, 한 번도 안 틀렸다는 결과가 나온다', () => {
    open();
    const pads = playRound(ten(400));
    expect(document.querySelector('.mini-overline')?.textContent).toBe('악보 보고 빨리 치기 · 힌트 켬');
    expect(Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent)).toEqual([
      '평균 0.40초.',
      '한 번도 안 틀렸어요.',
    ]);
    expect(document.querySelector('.mini-score-label')?.textContent).toBe('평균 반응');
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('0.40초');
    expect(document.querySelectorAll('.mini-sight-row')).toHaveLength(10);
    expect(rowPads()).toEqual(pads.map(name));
    for (let i = 0; i < 10; i += 1) {
      expect(screen.getByTestId(`mini-sight-row-${i}`).querySelector('.mini-sight-row-time')?.textContent).toBe('0.40초');
    }
    expect(document.querySelector('.mini-sight-bar-penalty')).toBeNull();
  });

  it('틀린 문제가 있으면 횟수 한 줄·벌점 막대·설명이 나온다', () => {
    open();
    playRound([400, 400, { ms: 700, wrongs: 1 }, ...Array<Step>(7).fill(400)]);
    // 평균: (9 × 400 + (700 + 500)) / 10 = 480
    expect(Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent)).toEqual([
      '평균 0.48초.',
      '1번 틀렸어요.',
    ]);
    const row = screen.getByTestId('mini-sight-row-2');
    expect(row.querySelector('.mini-sight-bar-penalty')).not.toBeNull();
    expect(row.querySelector('.mini-sight-row-time')?.textContent).toBe('1.20초');
    expect(screen.getByTestId('mini-sight-row-0').querySelector('.mini-sight-bar-penalty')).toBeNull();
    expect(document.querySelectorAll('.mini-sight-bar-penalty')).toHaveLength(1);
    expect(row.getAttribute('data-grade')).toBe('bad');
  });

  it('시간 초과가 있으면 한 줄 평이 그것을 말하고 그 행은 「시간 초과」다', () => {
    open();
    playRound([400, 'timeout', ...Array<Step>(8).fill(400)]);
    // 평균: (9 × 400 + 5000) / 10 = 860
    expect(Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent)).toEqual([
      '평균 0.86초.',
      '1문제는 시간이 다 됐어요.',
    ]);
    const row = screen.getByTestId('mini-sight-row-1').querySelector('.mini-sight-row-time');
    expect(row?.textContent).toBe('시간 초과');
    expect(row?.classList.contains('is-bad')).toBe(true);
  });

  it('열 문제를 모두 시간 초과하면 맞힌 문제가 없다는 결과이고 기록이 남지 않는다', () => {
    open();
    playRound(Array<Step>(10).fill('timeout'));
    expect(Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent)).toEqual([
      '한 문제도 못 맞혔어요.',
      '스틱 연결과 패드 위치를 확인해 보세요.',
    ]);
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('—');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(document.querySelectorAll('.mini-sight-row-time.is-bad')).toHaveLength(10);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('미리 친 타격이 있어도 한 판은 열 문제다(문제 번호는 그대로)', () => {
    open();
    toPlaying();
    advance(500);
    emit({ tHit: performance.now() });
    expect(message().textContent).toBe(EARLY_TEXT);
    expect(count()).toBe('1 / 10');
    // 음표가 뜬 뒤 99ms 안에 친 것도 같다
    const shown = showNote();
    answer(shown, 50);
    expect(count()).toBe('1 / 10');
    playProblems(ten(400));
    expect(document.querySelectorAll('.mini-sight-row')).toHaveLength(10);
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('0.40초');
    expect(new Set(rowPads()).size).toBe(8);
  });
});

describe('최고 기록 문구와 저장', () => {
  const note = () => document.querySelector('.mini-score-note')?.textContent ?? null;
  const pill = () => document.querySelector('.mini-pill-new');

  it('첫 기록: 「첫 기록이에요」와 「새 최고 기록」', () => {
    open();
    playRound(ten(400));
    expect(note()).toBe('첫 기록이에요');
    expect(pill()?.textContent).toBe('새 최고 기록');
    expect(stored()['sight:hint-on']?.score).toBe(400);
  });

  it('갱신(더 낮음): 「지난 최고 0.52초」와 「새 최고 기록」, 저장 값이 바뀐다', () => {
    seedSight('hint-on', 520);
    open();
    playRound(ten(400));
    expect(note()).toBe('지난 최고 0.52초');
    expect(pill()).not.toBeNull();
    expect(stored()['sight:hint-on']?.score).toBe(400);
    expect(stored()['sight:hint-on']?.at).not.toBe(SEED_AT);
  });

  it('동점: 「최고 기록과 같아요」이고 「새 최고 기록」이 없으며 저장 값이 그대로다', () => {
    seedSight('hint-on', 400);
    open();
    playRound(ten(400));
    expect(note()).toBe('최고 기록과 같아요');
    expect(pill()).toBeNull();
    expect(stored()['sight:hint-on']).toEqual(sightRecord('hint-on', 400));
  });

  it('못 미침: 「최고 기록 0.35초까지 0.05초」이고 「새 최고 기록」이 없으며 저장 값이 그대로다', () => {
    seedSight('hint-on', 350);
    open();
    playRound(ten(400));
    expect(note()).toBe('최고 기록 0.35초까지 0.05초');
    expect(pill()).toBeNull();
    expect(stored()['sight:hint-on']).toEqual(sightRecord('hint-on', 350));
  });

  it('힌트 켬 기록은 힌트 끔 기록과 따로다(다른 갈래·다른 게임 기록은 건드리지 않는다)', () => {
    const dynamics: MiniRecord = {
      gameId: 'dynamics',
      score: 17,
      at: SEED_AT,
      detail: {
        feel: [42, 78, 109],
        shots: [
          { target: 52, actual: 46 },
          { target: 96, actual: 105 },
          { target: 74, actual: 76 },
        ],
      },
    };
    const speed: MiniRecord = { gameId: 'speed', score: 68, at: SEED_AT, detail: { perSecond: [68, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    const off = sightRecord('hint-off', 610);
    seed({ 'sight:hint-off': off, speed, dynamics });
    open();
    playRound(ten(400));
    // 힌트 끔의 610과 견주지 않고 첫 기록으로 본다
    expect(note()).toBe('첫 기록이에요');
    const saved = stored();
    expect(saved['sight:hint-on']?.score).toBe(400);
    expect(saved['sight:hint-off']).toEqual(off);
    expect(saved.speed).toEqual(speed);
    expect(saved.dynamics).toEqual(dynamics);
  });

  it('힌트 끔으로 한 판을 하면 힌트 끔 갈래에 쓰이고 힌트 켬 기록은 그대로다', () => {
    localStorage.setItem(HINT_KEY, 'off');
    const on = sightRecord('hint-on', 300);
    seed({ 'sight:hint-on': on });
    open();
    playRound(ten(500));
    expect(document.querySelector('.mini-overline')?.textContent).toBe('악보 보고 빨리 치기 · 힌트 끔');
    expect(note()).toBe('첫 기록이에요');
    const saved = stored();
    expect(saved['sight:hint-off']?.score).toBe(500);
    expect(saved['sight:hint-off']?.variant).toBe('hint-off');
    expect(saved['sight:hint-on']).toEqual(on);
  });

  it('저장된 기록의 모양: 갈래·평균(10ms 단위로 반올림)·낸 순서의 열 문제', () => {
    open();
    const times = [301, 402, 503, 604, 705, 306, 407, 508, 609, 710];
    const pads = playRound(times);
    // 평균 505.5ms → 510ms
    const saved = stored()['sight:hint-on'];
    expect(saved?.gameId).toBe('sight');
    expect(saved?.variant).toBe('hint-on');
    expect(saved?.score).toBe(510);
    expect(Date.parse(saved?.at ?? '')).not.toBeNaN();
    expect(saved?.detail).toEqual({
      problems: pads.map((pad, i) => ({ pad, ms: times[i], wrongs: 0, timedOut: false })),
    });
  });

  it('틀림·시간 초과도 그대로 저장된다', () => {
    open();
    const pads = playRound([{ ms: 700, wrongs: 1 }, 'timeout', ...Array<Step>(8).fill(400)]);
    const detail = stored()['sight:hint-on']?.detail as { problems: unknown[] } | undefined;
    const problemsSaved = detail?.problems ?? [];
    expect(problemsSaved[0]).toEqual({ pad: pads[0], ms: 1200, wrongs: 1, timedOut: false });
    expect(problemsSaved[1]).toEqual({ pad: pads[1], ms: 5000, wrongs: 0, timedOut: true });
    expect(problemsSaved).toHaveLength(10);
  });

  it('마무리 시간 동안에는 아직 쓰지 않는다', () => {
    open();
    toPlaying();
    playProblems(Array<Step>(9).fill(400));
    const last = showNote();
    answer(last, 400);
    advance(799);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    advance(1);
    expect(stored()['sight:hint-on']?.score).toBe(400);
  });

  it('로그인한 계정이면 그 계정의 키에 쓴다', () => {
    useAuth.setState({ status: 'authenticated', user: { id: 7 } as never });
    useMiniRecords.getState().reload();
    open();
    playRound(ten(400));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parseRecords(localStorage.getItem(`${STORAGE_KEY}.u7`))['sight:hint-on']?.score).toBe(400);
  });
});

describe('[다시 하기]', () => {
  it('결과가 뜨면 [다시 하기]에 포커스가 있고, 누르면 같은 힌트로 바로 카운트다운이 된다', () => {
    localStorage.setItem(HINT_KEY, 'off');
    open();
    playRound(ten(400));
    expect(document.activeElement).toBe(retryButton());
    clickRetry();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(count()).toBe('1 / 10');
    expect(dots().every((s) => s === 'now' || s === 'rest')).toBe(true);
    expect(cell('지금까지 평균')).toContain('–');
    expect(stageSub()).toBe('힌트 끔 · 10문제');
    expect(lastActive()).toBe(true);
  });

  it('두 번째 판은 첫 판의 기록과 견주고 첫 판의 답이 섞이지 않는다', () => {
    open();
    playRound(ten(400));
    clickRetry();
    advance(3000);
    expect(notePad()).toBeNull();
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    playProblems(ten(500));
    expect(document.querySelector('.mini-score-note')?.textContent).toBe('최고 기록 0.40초까지 0.10초');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(document.querySelectorAll('.mini-sight-row')).toHaveLength(10);
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('0.50초');
    expect(stored()['sight:hint-on']?.score).toBe(400);
  });
});

describe('[그만하기]와 화면 이탈', () => {
  it('플레이 중 [그만하기] → 안내에 돌아오고 기록이 남지 않으며 [시작하기]에 포커스가 간다', () => {
    open();
    toPlaying();
    playProblems([400, 400]);
    const shown = showNote();
    answer(shown, 300);
    expect(count()).toBe('4 / 10');
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(10_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('sight', 'hint-on')).toBeNull();
    expect(lastActive()).toBe(false);
  });

  it('대기·카운트다운 중 [그만하기]도 남는 타이머 없이 안내로 돌아온다', () => {
    open();
    clickStart();
    advance(1000);
    clickQuit();
    advance(10_000);
    expect(introShown()).toBe(true);
    cleanup();

    open();
    toPlaying();
    advance(400);
    clickQuit();
    advance(10_000);
    expect(introShown()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('돌아와서 다시 시작하면 처음부터다', () => {
    open();
    playRound([400]);
    clickQuit();
    clickStart();
    expect(countdownValue()).toBe('3');
    expect(count()).toBe('1 / 10');
    advance(3000);
    expect(dots().filter((s) => s === 'ok')).toHaveLength(0);
  });

  it('플레이 중 화면을 떠나면(언마운트) 기록이 남지 않는다', () => {
    const { unmount } = open();
    toPlaying();
    playProblems([400, 400]);
    const shown = showNote();
    answer(shown, 300);
    unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('sight', 'hint-on')).toBeNull();
  });
});

describe('키보드 드럼 스위치', () => {
  it('카운트다운·플레이에서만 켜지고 안내·마무리·결과에서는 꺼져 있다', () => {
    open();
    expect(lastActive()).toBe(false);
    clickStart();
    expect(lastActive()).toBe(true);
    advance(3000);
    expect(lastActive()).toBe(true);
    playProblems(Array<Step>(9).fill(400));
    expect(lastActive()).toBe(true);
    const last = showNote();
    answer(last, 400);
    expect(lastActive()).toBe(false);
    advance(800);
    expect(retryButton()).toBeTruthy();
    expect(lastActive()).toBe(false);
    clickRetry();
    expect(lastActive()).toBe(true);
  });

  it('[그만하기]로 안내에 돌아오면 다시 꺼진다', () => {
    open();
    clickStart();
    expect(lastActive()).toBe(true);
    clickQuit();
    expect(lastActive()).toBe(false);
  });
});
