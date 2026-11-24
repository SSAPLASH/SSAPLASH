// @vitest-environment happy-dom
// DynamicsGamePage 검증(설계 MODE-006-minigame-dynamics-match 4절): 가짜 타이머로 한 판(감 잡기 3타 → 내 세기 2.5초 → 숫자 맞추기 3타 → 마무리 1.2초)을 끝까지 돌린다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
// 목표는 Math.random을 상수로 바꿔 고정한다(makeMatchTargets: 내 세기 42·78·109에서 난수가 0이면 [69, 92, 47], 0.999999면 [59, 82, 104]).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { DynamicsGamePage } from '@/features/mini/DynamicsGamePage';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn() }));
vi.mock('@/runtime/hitSound', () => ({ setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));
vi.mock('@/runtime/sensorRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/sensorRegistry')>()),
  sensorRegistry: { get: vi.fn() },
}));

const STORAGE_KEY = 'ssaplash.mini.v1';
const SEED_AT = '2026-11-01T09:00:00.000Z';
const ORIGINAL_SENSOR_KIND = useSettings.getState().sensorKind;

/** 감 잡기에서 친 내 세기(약·중·강) */
const FEEL = [42, 78, 109];
/** 내 세기 FEEL에서 난수가 항상 0일 때의 목표(1타·2타·3타) */
const TARGETS = [69, 92, 47];
/** 목표에서 (−6, +9, −2)만큼 벗어나게 친 기준 예시. 오차 합 17 */
const REFERENCE = [63, 101, 45];
/** 감 잡기 뒤 「내 세기」를 보이는 시간 */
const REVIEW_MS = 2500;

let nextId = 1;
let randomSpy: MockInstance<() => number>;
let randomValue = 0;

function seedRecord(score: number): MiniRecord {
  return {
    gameId: 'dynamics',
    score,
    at: SEED_AT,
    detail: {
      feel: [40, 80, 100],
      shots: [
        { target: 64, actual: 60 },
        { target: 84, actual: 88 },
        { target: 44, actual: 44 },
      ],
    },
  };
}

function seedBest(score: number) {
  localStorage.setItem(STORAGE_KEY, serializeRecords({ dynamics: seedRecord(score) }));
}

function storedRecords() {
  return parseRecords(localStorage.getItem(STORAGE_KEY));
}

function storedBest(): MiniRecord | null {
  return storedRecords().dynamics ?? null;
}

interface EmitOver {
  id?: number;
  pad?: PadId | null;
  source?: string;
  velocity?: number;
  tHit: number;
  tRecv?: number;
}

/** 타격 한 번을 실제 앱과 같은 길로 넣는다(기본은 센서 소스의 스네어) */
function emit(over: EmitOver) {
  const hit = {
    id: over.id ?? nextId++,
    stickId: null,
    pad: over.pad === undefined ? 'SNARE' : over.pad,
    source: over.source ?? 'webserial',
    velocity: over.velocity ?? 100,
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
    <MemoryRouter initialEntries={['/play/mini/dynamics']}>
      <Routes>
        <Route path="/play/mini/dynamics" element={<DynamicsGamePage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const startButton = () => screen.getByRole('button', { name: '시작하기' });
const clickStart = () => fireEvent.click(startButton());
const clickQuit = () => fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
const clickRetry = () => fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
const countdownValue = () => document.querySelector('.play-countdown-value')?.textContent ?? null;
const introShown = () => screen.queryByText('내 세기를 재고') !== null;
const gauge = (i: number) => screen.getByTestId(`mini-dyn-gauge-${i}`);
const states = () => [0, 1, 2].map((i) => gauge(i).getAttribute('data-state'));
const prompt = () => screen.getByTestId('mini-dyn-prompt').textContent;
const status = (i: number) => gauge(i).querySelector('.mini-dyn-gauge-status');
const gaugeHeads = () => [0, 1, 2].map((i) => gauge(i).querySelector('.mini-dyn-gauge-head')?.textContent);
const targetTexts = () => [0, 1, 2].map((i) => screen.getByTestId(`mini-dyn-target-${i}`).textContent);
const feelItems = () => Array.from(document.querySelectorAll('.mini-dyn-feel-item')).map((el) => el.textContent);
const headline = () => Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent);
const scoreNote = () => document.querySelector('.mini-score-note')?.textContent ?? null;
const scoreLabel = () => document.querySelector('.mini-score-label')?.textContent ?? null;
const scoreValue = () => document.querySelector('.mini-score-value > span')?.textContent ?? null;
const rowText = (i: number, cls: string) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector(cls)?.textContent;
const rowMeta = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector('.mini-dyn-row-meta');

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

/** 보호 시간(300ms)을 넘겨 치는 간격 */
const GAP = 400;

/** 카운트다운 3초를 지난다. 플레이가 시작된 순간(= 시작 시각)의 performance.now()를 돌려준다 */
function afterCountdown(): number {
  advance(3000);
  return performance.now();
}

/** [시작하기] → 카운트다운 3초 → 감 잡기 시작 시각 */
function toPlaying(): number {
  clickStart();
  return afterCountdown();
}

/** 시작 시각 뒤 GAP 간격으로 주어진 세기를 친다 */
function hitAll(t0: number, velocities: readonly number[]) {
  velocities.forEach((velocity, i) => emit({ tHit: t0 + GAP * (i + 1), velocity }));
}

/** 감 잡기 3타 → 내 세기 2.5초를 지나 숫자 맞추기가 시작된 순간의 performance.now()를 돌려준다. `begin`은 판을 여는 동작([시작하기] 또는 [다시 하기]) */
function toMatch(feel: readonly number[] = FEEL, begin: () => void = clickStart): number {
  begin();
  const t0 = afterCountdown();
  hitAll(t0, feel);
  advance(REVIEW_MS);
  return performance.now();
}

/** 한 판을 끝까지: 감 잡기 3타 → 2.5초 → 숫자 맞추기 3타 → 마무리(1.2초)를 지나 결과 화면까지 간다 */
function playRound(matchVelocities: readonly number[], feel: readonly number[] = FEEL, begin: () => void = clickStart) {
  const m0 = toMatch(feel, begin);
  hitAll(m0, matchVelocities);
  advance(1200);
}

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 1;
  randomValue = 0;
  randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => randomValue);
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
  useMiniRecords.setState({ owner: null, records: {} });
  useSettings.setState({ sensorKind: 'webserial' });
  useLive.setState({ connected: [true, false], lastHit: null, hitSeq: 0 });
  vi.mocked(unlockAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSoundOnHit).mockReset();
  vi.mocked(useKeyboardDrum).mockReset();
  vi.mocked(sensorRegistry.get).mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  randomSpy.mockRestore();
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useSettings.setState({ sensorKind: ORIGINAL_SENSOR_KIND });
  useLive.setState({ connected: [false, false], lastHit: null, hitSeq: 0 });
});

describe('안내 단계', () => {
  it('열면 안내 단계다: 작은 글·제목 두 줄·설명·칸 세 개', () => {
    open();
    expect(screen.getByText('강약중강약')).toBeTruthy();
    expect(screen.getByText('내 세기를 재고')).toBeTruthy();
    expect(screen.getByText('숫자에 맞춰 치세요.')).toBeTruthy();
    expect(screen.getByText('먼저 약·중·강을 한 번씩 쳐서 내 세기를 재요. 그다음 숫자 세 개에 맞춰 칩니다.')).toBeTruthy();
    expect(cell('한 판')).toContain('3+3');
    expect(cell('한 판')).toContain('타');
    expect(cell('한 판')).toContain('재기 3타, 맞추기 3타');
    expect(cell('치는 곳')).toContain('스네어');
    expect(cell('내 최고 기록')).not.toBeNull();
    expect(screen.queryByTestId('mini-dyn-prompt')).toBeNull();
  });

  it('저장된 최고 기록이 없으면 「—」가 보인다', () => {
    open();
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('저장된 최고 기록이 있으면 「오차 14」와 「낮을수록 좋아요」가 보인다', () => {
    seedBest(14);
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('오차 14');
    expect(best).toContain('낮을수록 좋아요');
    expect(best).not.toContain('—');
  });

  it('예전 모양의 기록(점수 94, level이 있고 feel이 없다)이 저장돼 있으면 최고 기록이 「—」다', () => {
    const old = {
      gameId: 'dynamics',
      score: 94,
      at: SEED_AT,
      detail: {
        shots: [
          { level: 'weak', target: 45, actual: 39 },
          { level: 'strong', target: 110, actual: 119 },
          { level: 'mid', target: 75, actual: 73 },
        ],
      },
    } as unknown as MiniRecord;
    localStorage.setItem(STORAGE_KEY, serializeRecords({ dynamics: old }));
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('—');
    expect(best).not.toContain('94');
    expect(best).not.toContain('오차');
  });

  it('센서가 없으면(none) [시작하기]가 꺼지고 사유와 [드럼 세팅]이 보인다', () => {
    useSettings.setState({ sensorKind: 'none' });
    open();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '드럼 세팅' })).toBeTruthy();
  });

  it('동글인데 두 손 다 연결이 없으면 꺼져 있고, 한 손이 연결되면 켜지며 사유가 사라진다', () => {
    useLive.setState({ connected: [false, false] });
    open();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.')).toBeTruthy();
    act(() => {
      useLive.setState({ connected: [false, true] });
    });
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.')).toBeNull();
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
  });

  it('포인터(사용 안내가 있는 소스)는 연결이 없어도 시작할 수 있다', () => {
    useSettings.setState({ sensorKind: 'pointer' });
    vi.mocked(sensorRegistry.get).mockReturnValue({ usageGuide: () => '' } as never);
    useLive.setState({ connected: [false, false] });
    open();
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.')).toBeNull();
  });

  it('공용 타격음은 화면에 있는 동안만 켜지고 키보드 드럼은 켜지 않는다', () => {
    const { unmount } = open();
    expect(vi.mocked(setSoundOnHit).mock.calls.at(-1)).toEqual([true]);
    toPlaying();
    emit({ tHit: performance.now() + GAP });
    advance(5000);
    expect(vi.mocked(setSoundOnHit).mock.calls).toEqual([[true]]);
    unmount();
    expect(vi.mocked(setSoundOnHit).mock.calls.at(-1)).toEqual([false]);
    expect(useKeyboardDrum).not.toHaveBeenCalled();
  });

  it('[시작하기]는 오디오 잠금을 푼다', () => {
    open();
    expect(unlockAudio).not.toHaveBeenCalled();
    clickStart();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });

  it('오디오 잠금을 풀지 못해도 소리 없이 진행한다', async () => {
    vi.mocked(unlockAudio).mockRejectedValue(new Error('blocked'));
    open();
    clickStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(countdownValue()).toBe('3');
  });
});

describe('카운트다운', () => {
  it('시작하면 3·2·1(1초씩)이 돌고 감 잡기 눈금 세 개가 이미 보이며 첫 번째가 지금 차례다', () => {
    open();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(gaugeHeads()).toEqual(['약', '중', '강']);
    expect(prompt()).toBe('약하게 한 번.');
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(1000);
    expect(countdownValue()).toBeNull();
    expect(screen.getByRole('button', { name: '그만하기' })).toBeTruthy();
  });

  it('카운트다운 중에 친 스네어는 감 잡기 타수가 아니다(플레이가 시작돼도 하나도 끝나지 않는다)', () => {
    open();
    clickStart();
    advance(1500);
    emit({ tHit: performance.now() });
    advance(500);
    emit({ tHit: performance.now() });
    expect(states()).toEqual(['current', 'next', 'next']);
    advance(1000);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(prompt()).toBe('약하게 한 번.');
  });
});

describe('감 잡기', () => {
  it('머리 문구가 「약하게 한 번.」이고 아래 글·약·중·강 눈금이 보이며 점수와 목표가 없다', () => {
    open();
    toPlaying();
    expect(prompt()).toBe('약하게 한 번.');
    expect(screen.getByText('점수는 없어요. 내 세기를 먼저 재요.')).toBeTruthy();
    expect(gaugeHeads()).toEqual(['약', '중', '강']);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
    expect(status(1)?.textContent).toBe('다음');
  });

  it('감 잡기 중에는 내 세기 줄과 목표 숫자가 없다', () => {
    open();
    const t0 = toPlaying();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-target-0')).toBeNull();
    emit({ tHit: t0 + GAP, velocity: 42 });
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-target-0')).toBeNull();
    expect(gauge(0).textContent).not.toContain('목표');
  });

  it('치는 대로 약·중·강 눈금에 값이 나오고 머리 문구가 바뀐다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 42 });
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('42');
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(prompt()).toBe('중간으로 한 번.');
    emit({ tHit: t0 + GAP * 2, velocity: 78 });
    expect(screen.getByTestId('mini-dyn-actual-1').textContent).toBe('78');
    expect(states()).toEqual(['done', 'done', 'current']);
    expect(prompt()).toBe('강하게 한 번.');
    emit({ tHit: t0 + GAP * 3, velocity: 109 });
    expect(screen.getByTestId('mini-dyn-actual-2').textContent).toBe('109');
    expect(states()).toEqual(['done', 'done', 'done']);
  });

  it('시작 299ms 뒤의 타격은 받지 않고 300ms 뒤는 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 299, velocity: 42 });
    expect(states()).toEqual(['current', 'next', 'next']);
    emit({ tHit: t0 + 300, velocity: 42 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('받은 타격에서 300ms가 안 지난 타격은 받지 않고 지난 타격은 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 400, velocity: 42 });
    emit({ tHit: t0 + 400 + 299, velocity: 78 });
    expect(states()).toEqual(['done', 'current', 'next']);
    emit({ tHit: t0 + 400 + 300, velocity: 78 });
    expect(states()).toEqual(['done', 'done', 'current']);
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    const t0 = toPlaying();
    emit({ id: 77, tHit: t0 + GAP, velocity: 42 });
    emit({ id: 77, tHit: t0 + GAP, velocity: 42 });
    expect(states()).toEqual(['done', 'current', 'next']);
    // id가 다르면 따로 센다(같은 시각이라 보호 시간 때문에 받지는 않는다)
    emit({ id: 78, tHit: t0 + GAP, velocity: 42 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('키보드 스네어·패드 없음 타격은 받지 않고 안내도 없다', () => {
    open();
    const t0 = toPlaying();
    emit({ source: 'keyboard', tHit: t0 + GAP });
    expect(states()).toEqual(['current', 'next', 'next']);
    emit({ pad: null, tHit: t0 + GAP * 2 });
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
    expect(status(0)?.className).not.toContain('is-hint');
  });

  it('센서의 다른 패드(하이햇) 타격은 받지 않고 지금 차례에 「스네어를 쳐 주세요」를 보였다가 1.5초 뒤 되돌린다', () => {
    open();
    const t0 = toPlaying();
    emit({ pad: 'HIHAT', tHit: t0 + GAP });
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    expect(status(0)?.className).toContain('is-hint');
    expect(status(1)?.textContent).toBe('다음');
    advance(1499);
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    advance(1);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
  });

  it('스네어를 치면 안내가 바로 사라진다', () => {
    open();
    const t0 = toPlaying();
    emit({ pad: 'HIHAT', tHit: t0 + GAP });
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    emit({ tHit: t0 + GAP * 2, velocity: 42 });
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(status(1)?.textContent).toBe('지금 칠 차례');
    expect(document.querySelector('.is-hint')).toBeNull();
  });

  it('세기 127과 1도 그대로 보인다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 127 });
    emit({ tHit: t0 + GAP * 2, velocity: 1 });
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('127');
    expect(screen.getByTestId('mini-dyn-actual-1').textContent).toBe('1');
  });
});

describe('내 세기 보이기(사이)', () => {
  it('세 번째를 받으면 「내 세기를 쟀어요.」, 2499ms까지는 그대로이고 2500ms에 숫자 맞추기로 바뀐다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, FEEL);
    expect(prompt()).toBe('내 세기를 쟀어요.');
    expect(screen.getByText('이제 숫자에 맞춰 칩니다.')).toBeTruthy();
    expect(states()).toEqual(['done', 'done', 'done']);
    expect(screen.queryByText('지금 칠 차례')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    advance(REVIEW_MS - 1);
    expect(prompt()).toBe('내 세기를 쟀어요.');
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    advance(1);
    expect(prompt()).toBe('69에 맞춰 한 번.');
    expect(feelItems()).toEqual(['약 42', '중 78', '강 109']);
    expect(targetTexts()).toEqual(['69', '92', '47']);
    expect(gaugeHeads()).toEqual(['1타69', '2타92', '3타47']);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(screen.getByText('내 세기를 보고 힘을 가늠하세요.')).toBeTruthy();
  });

  it('난수에 따라 목표가 달라진다(난수가 0.999999면 59·82·104)', () => {
    randomValue = 0.999999;
    open();
    toMatch();
    expect(targetTexts()).toEqual(['59', '82', '104']);
    expect(prompt()).toBe('59에 맞춰 한 번.');
  });

  it('사이 2.5초 동안 친 타격은 숫자 맞추기 타수가 아니다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, FEEL);
    advance(1000);
    emit({ tHit: performance.now(), velocity: 100 });
    advance(1499);
    expect(prompt()).toBe('내 세기를 쟀어요.');
    advance(1);
    expect(prompt()).toBe('69에 맞춰 한 번.');
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(screen.queryByTestId('mini-dyn-actual-0')).toBeNull();
  });

  it('사이에 타격이 와도 감 잡기 세 번째로부터 2500ms에 넘어간다(타이머가 다시 걸리지 않는다)', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, FEEL);
    advance(2000);
    emit({ tHit: performance.now(), velocity: 100 });
    advance(499);
    expect(prompt()).toBe('내 세기를 쟀어요.');
    advance(1);
    expect(prompt()).toBe('69에 맞춰 한 번.');
  });

  it('사이에는 다른 패드 안내도 나오지 않고, 숫자 맞추기가 시작되면 남아 있지 않다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, FEEL);
    emit({ pad: 'HIHAT', tHit: performance.now() });
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
    expect(document.querySelector('.is-hint')).toBeNull();
    advance(REVIEW_MS);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
  });
});

describe('숫자 맞추기', () => {
  it('숫자 맞추기 시작 뒤 299ms의 타격은 받지 않고 300ms의 타격은 받는다', () => {
    open();
    const m0 = toMatch();
    emit({ tHit: m0 + 299, velocity: 63 });
    expect(states()).toEqual(['current', 'next', 'next']);
    emit({ tHit: m0 + 300, velocity: 63 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('받은 타격은 친 값·「목표 N」·차이 문구로 보이고 머리 문구가 다음 숫자로 바뀐다', () => {
    open();
    const m0 = toMatch();
    emit({ tHit: m0 + GAP, velocity: 63 });
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('63');
    expect(gauge(0).textContent).toContain('목표 69');
    expect(gauge(0).textContent).toContain('6 약했어요');
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(prompt()).toBe('92에 맞춰 한 번.');
    emit({ tHit: m0 + GAP * 2, velocity: 101 });
    expect(gauge(1).textContent).toContain('목표 92');
    expect(gauge(1).textContent).toContain('9 셌어요');
    expect(prompt()).toBe('47에 맞춰 한 번.');
    expect(feelItems()).toEqual(['약 42', '중 78', '강 109']);
  });

  it('받은 타격에서 300ms가 안 지난 타격은 받지 않고 지난 타격은 받는다', () => {
    open();
    const m0 = toMatch();
    emit({ tHit: m0 + 400, velocity: 63 });
    emit({ tHit: m0 + 400 + 299, velocity: 101 });
    expect(states()).toEqual(['done', 'current', 'next']);
    emit({ tHit: m0 + 400 + 300, velocity: 101 });
    expect(states()).toEqual(['done', 'done', 'current']);
  });

  it('키보드·패드 없음 타격은 받지 않고, 다른 패드 안내는 지금 차례에 보였다가 1.5초 뒤 사라진다', () => {
    open();
    const m0 = toMatch();
    emit({ source: 'keyboard', tHit: m0 + GAP });
    emit({ pad: null, tHit: m0 + GAP });
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(document.querySelector('.is-hint')).toBeNull();
    emit({ pad: 'HIHAT', tHit: m0 + GAP });
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    expect(status(0)?.className).toContain('is-hint');
    advance(1499);
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    advance(1);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
  });

  it('스네어를 치면 다른 패드 안내가 바로 사라진다', () => {
    open();
    const m0 = toMatch();
    emit({ pad: 'HIHAT', tHit: m0 + GAP });
    expect(status(0)?.textContent).toBe('스네어를 쳐 주세요');
    emit({ tHit: m0 + GAP * 2, velocity: 63 });
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(document.querySelector('.is-hint')).toBeNull();
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    const m0 = toMatch();
    emit({ id: 900, tHit: m0 + GAP, velocity: 63 });
    emit({ id: 900, tHit: m0 + GAP, velocity: 63 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('세 번째 타격 → 「세 번 다 쳤어요.」, 지금 차례가 없고 더 쳐도 바뀌지 않으며 1.2초 뒤 결과가 뜬다', () => {
    open();
    const m0 = toMatch();
    hitAll(m0, REFERENCE);
    expect(prompt()).toBe('세 번 다 쳤어요.');
    expect(screen.queryByText('내 세기를 보고 힘을 가늠하세요.')).toBeNull();
    expect(states()).toEqual(['done', 'done', 'done']);
    emit({ tHit: m0 + GAP * 5, velocity: 10 });
    expect(screen.getByTestId('mini-dyn-actual-2').textContent).toBe('45');
    advance(1199);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    advance(1);
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
    expect(screen.queryByTestId('mini-dyn-prompt')).toBeNull();
  });
});

describe('결과', () => {
  it('기준 예시: 차이 −6·+9·−2 → 「오차 17.」, 점수 칸·한 줄 평·행·내 세기 줄·강조가 맞다', () => {
    open();
    playRound(REFERENCE);
    expect(headline()).toEqual(['오차 17.', '2타가 조금 셌어요.']);
    expect(scoreLabel()).toBe('오차 합');
    expect(scoreValue()).toBe('17');
    expect(feelItems()).toEqual(['약 42', '중 78', '강 109']);
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-label'))).toEqual(['1타', '2타', '3타']);
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-actual'))).toEqual(['63', '101', '45']);
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-meta'))).toEqual(['목표 69 · 6 약함', '목표 92 · 9 셈', '목표 47 · 2 약함']);
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-score'))).toEqual(['오차 6', '오차 9', '오차 2']);
    expect(rowMeta(0)?.className).not.toContain('is-warn');
    expect(rowMeta(1)?.className).toContain('is-warn');
    expect(rowMeta(2)?.className).not.toContain('is-warn');
    expect(document.querySelectorAll('.is-warn')).toHaveLength(1);
  });

  it('세 번 다 딱 맞으면 「오차 0.」이고 강조되는 행이 없다', () => {
    open();
    playRound(TARGETS);
    expect(headline()).toEqual(['오차 0.', '세 번 모두 딱 맞았어요.']);
    expect(scoreValue()).toBe('0');
    expect(document.querySelector('.is-warn')).toBeNull();
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-score'))).toEqual(['오차 0', '오차 0', '오차 0']);
  });

  it('가장 큰 차이가 13이면 한 줄 평에 「많이」가 들어간다', () => {
    open();
    playRound([69, 92, 34]);
    expect(headline()).toEqual(['오차 13.', '3타가 많이 약했어요.']);
    expect(rowMeta(2)?.className).toContain('is-warn');
  });

  it('첫 기록: 「첫 기록이에요」와 「새 최고 기록」', () => {
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('첫 기록이에요');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
  });

  it('갱신(더 낮음): 「지난 최고 오차 21」과 「새 최고 기록」, 저장 값이 바뀐다', () => {
    seedBest(21);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('지난 최고 오차 21');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(17);
    expect(storedBest()?.at).not.toBe(SEED_AT);
  });

  it('동점: 「최고 기록과 같아요」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(17);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록과 같아요');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(17));
  });

  it('못 미침(더 높음): 「최고 기록 오차 9」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(9);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록 오차 9');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(9));
  });
});

describe('저장', () => {
  it('첫 판의 저장 값은 오차 합·내 세기·목표와 실제 세기를 친 순서대로 담고, 화면을 다시 열면 안내 칸에 보인다', () => {
    const { unmount } = open();
    const m0 = toMatch();
    hitAll(m0, REFERENCE);
    // 마무리 시간 동안에는 아직 쓰지 않는다
    expect(storedBest()).toBeNull();
    advance(1200);
    const saved = storedBest();
    expect(saved?.gameId).toBe('dynamics');
    expect(saved?.score).toBe(17);
    expect(typeof saved?.at).toBe('string');
    expect(saved?.detail).toEqual({
      feel: [42, 78, 109],
      shots: [
        { target: 69, actual: 63 },
        { target: 92, actual: 101 },
        { target: 47, actual: 45 },
      ],
    });
    unmount();
    open();
    expect(introShown()).toBe(true);
    const best = cell('내 최고 기록');
    expect(best).toContain('오차 17');
    expect(best).toContain('낮을수록 좋아요');
  });

  it('로그인한 계정이면 그 계정의 키에 쓴다', () => {
    useAuth.setState({ status: 'authenticated', user: { id: 7 } as never });
    useMiniRecords.getState().reload();
    open();
    playRound(REFERENCE);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parseRecords(localStorage.getItem(`${STORAGE_KEY}.u7`)).dynamics?.score).toBe(17);
  });

  it('다른 게임(speed)의 저장된 기록은 건드리지 않는다', () => {
    const speed: MiniRecord = { gameId: 'speed', score: 61, at: SEED_AT, detail: { perSecond: [61, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed }));
    open();
    playRound(REFERENCE);
    const records = storedRecords();
    expect(records.speed).toEqual(speed);
    expect(records.dynamics?.score).toBe(17);
  });
});

describe('[다시 하기]', () => {
  it('결과가 뜰 때 [다시 하기]가 포커스를 받는다', () => {
    open();
    playRound(REFERENCE);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 하기' }));
  });

  it('목록을 거치지 않고 카운트다운부터 감 잡기로 시작하고, 내 세기 줄·목표·앞 판의 타격이 없다', () => {
    open();
    playRound(REFERENCE);
    clickRetry();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(gaugeHeads()).toEqual(['약', '중', '강']);
    expect(prompt()).toBe('약하게 한 번.');
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-target-0')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-actual-0')).toBeNull();
    advance(3000);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(prompt()).toBe('약하게 한 번.');
    expect(screen.queryByTestId('mini-dyn-actual-0')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
  });

  it('두 번째 판을 끝까지 하면 새 내 세기·새 목표로 결과가 나오고 첫 판의 기록과 견준다', () => {
    open();
    playRound(REFERENCE);
    // 내 세기 40·80·100에서 난수가 0이면 목표는 [64, 84, 44]
    playRound([64, 84, 44], [40, 80, 100], clickRetry);
    expect(headline()).toEqual(['오차 0.', '세 번 모두 딱 맞았어요.']);
    expect(feelItems()).toEqual(['약 40', '중 80', '강 100']);
    expect([0, 1, 2].map((i) => rowText(i, '.mini-dyn-row-meta'))).toEqual(['목표 64 · 딱 맞음', '목표 84 · 딱 맞음', '목표 44 · 딱 맞음']);
    expect(scoreNote()).toBe('지난 최고 오차 17');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(0);
    expect(storedBest()?.detail).toEqual({
      feel: [40, 80, 100],
      shots: [
        { target: 64, actual: 64 },
        { target: 84, actual: 84 },
        { target: 44, actual: 44 },
      ],
    });
  });
});

describe('[그만하기]와 화면 이탈', () => {
  it('감 잡기 중 [그만하기] → 안내로 돌아오고 기록이 남지 않으며 [시작하기]가 포커스를 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 42 });
    expect(states()).toEqual(['done', 'current', 'next']);
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('dynamics')).toBeNull();
  });

  it('사이(내 세기 보이기) 중 [그만하기] → 기록이 없고, 2.5초가 지나도 숫자 맞추기로 넘어가지 않는다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, FEEL);
    advance(1000);
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(REVIEW_MS);
    expect(introShown()).toBe(true);
    expect(screen.queryByTestId('mini-dyn-prompt')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('dynamics')).toBeNull();
  });

  it('숫자 맞추기 중 [그만하기] → 기록이 남지 않고 [시작하기]가 포커스를 받는다', () => {
    open();
    const m0 = toMatch();
    emit({ tHit: m0 + GAP, velocity: 63 });
    emit({ tHit: m0 + GAP * 2, velocity: 101 });
    expect(states()).toEqual(['done', 'done', 'current']);
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('dynamics')).toBeNull();
  });

  it('감 잡기·사이·숫자 맞추기 중에 화면을 떠나면(언마운트) 기록이 남지 않는다', () => {
    const feelPhase = open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 42 });
    feelPhase.unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const reviewPhase = open();
    const t1 = toPlaying();
    hitAll(t1, FEEL);
    reviewPhase.unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const matchPhase = open();
    const m0 = toMatch();
    emit({ tHit: m0 + GAP, velocity: 63 });
    emit({ tHit: m0 + GAP * 2, velocity: 101 });
    matchPhase.unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('dynamics')).toBeNull();
  });

  it('숫자 맞추기 중에 그만둔 뒤 다시 시작하면 감 잡기부터이고 앞 판의 내 세기·목표가 없다', () => {
    open();
    const m0 = toMatch();
    emit({ tHit: m0 + GAP, velocity: 10 });
    clickQuit();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    clickStart();
    expect(countdownValue()).toBe('3');
    expect(prompt()).toBe('약하게 한 번.');
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-target-0')).toBeNull();
    advance(3000);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(prompt()).toBe('약하게 한 번.');
  });

  it('그만둔 판 뒤에 끝까지 한 판을 하면 그 판의 값만 저장된다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 10 });
    clickQuit();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    playRound(REFERENCE);
    expect(headline()[0]).toBe('오차 17.');
    expect(storedBest()?.detail).toEqual({
      feel: [42, 78, 109],
      shots: [
        { target: 69, actual: 63 },
        { target: 92, actual: 101 },
        { target: 47, actual: 45 },
      ],
    });
  });
});
