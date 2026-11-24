// @vitest-environment happy-dom
// DynamicsGamePage 검증(설계 MODE-006-minigame-dynamics 4절): 가짜 타이머로 한 판을 끝까지 돌린다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
// 목표는 Math.random을 정해 둔 순서로 돌려주어 고정한다(makeTargets: 섞기 두 번 → 목표 값 뽑기 세 번).
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

/**
 * 난수 순서 A: 섞기 [0.99 → 그대로, 0 → 앞의 둘을 맞바꿈] = 약·강·중, 값 뽑기 0.5·0.5·0.3
 * → 1타 약 45 / 2타 강 110 / 3타 중 75
 */
const SEQ_A = [0.99, 0, 0.5, 0.5, 0.3];
/** 난수 순서 B: 전부 0 → 1타 약 35 / 2타 중 70 / 3타 강 100 */
const SEQ_B = [0, 0, 0, 0, 0];

let nextId = 1;
let randomSpy: MockInstance<() => number>;
let randomQueue: number[] = [];

/** 다음에 목표를 뽑을 때 쓸 난수 순서를 건다(바닥나면 0.5) */
function script(sequence: readonly number[]) {
  randomQueue = [...sequence];
}

function seedRecord(score: number): MiniRecord {
  return {
    gameId: 'dynamics',
    score,
    at: SEED_AT,
    detail: {
      shots: [
        { level: 'weak', target: 40, actual: 40 },
        { level: 'strong', target: 100, actual: 100 },
        { level: 'mid', target: 80, actual: 80 },
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
const introShown = () => screen.queryByText('세 번의 타격을') !== null;
const gauge = (i: number) => screen.getByTestId(`mini-dyn-gauge-${i}`);
const states = () => [0, 1, 2].map((i) => gauge(i).getAttribute('data-state'));
const prompt = () => screen.getByTestId('mini-dyn-prompt').textContent;
const status = (i: number) => gauge(i).querySelector('.mini-dyn-gauge-status');
const headline = () => Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent);
const scoreNote = () => document.querySelector('.mini-score-note')?.textContent ?? null;
const rowMeta = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector('.mini-dyn-row-meta');
const rowScore = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector('.mini-dyn-row-score')?.textContent;

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

/** 시작 → 카운트다운 3초. 플레이가 시작된 순간(= 시작 시각)의 performance.now()를 돌려준다 */
function toPlaying(sequence: readonly number[] = SEQ_A): number {
  script(sequence);
  clickStart();
  advance(3000);
  return performance.now();
}

/** 보호 시간(300ms)을 넘겨 세 번 치는 간격 */
const GAP = 400;

/** 시작 시각 뒤 GAP 간격으로 주어진 세기를 친다 */
function hitAll(t0: number, velocities: readonly number[]) {
  velocities.forEach((velocity, i) => emit({ tHit: t0 + GAP * (i + 1), velocity }));
}

/** 한 판을 끝까지: 세 번 치고 마무리(1.2초)를 지나 결과 화면까지 간다 */
function playRound(velocities: readonly number[], sequence: readonly number[] = SEQ_A) {
  const t0 = toPlaying(sequence);
  hitAll(t0, velocities);
  advance(1200);
}

/** 목표 A에서 (목표 − 6, 목표 + 9, 목표 − 2)로 친 기준 예시. 94점 */
const REFERENCE = [39, 119, 73];

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 1;
  randomQueue = [];
  randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => randomQueue.shift() ?? 0.5);
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
    expect(screen.getByText('세 번의 타격을')).toBeTruthy();
    expect(screen.getByText('제시한 세기에 맞추세요.')).toBeTruthy();
    expect(screen.getByText('강·약·중이 한 번씩 나와요. 순서와 목표는 판마다 달라요.')).toBeTruthy();
    expect(cell('한 판')).toContain('3');
    expect(cell('한 판')).toContain('타');
    expect(cell('치는 곳')).toContain('스네어');
    expect(cell('내 최고 기록')).not.toBeNull();
    expect(screen.queryByTestId('mini-dyn-prompt')).toBeNull();
  });

  it('저장된 최고 기록이 없으면 「—」가 보인다', () => {
    open();
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('저장된 최고 기록이 있으면 「N점」이 보인다', () => {
    seedBest(88);
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('88');
    expect(best).toContain('점');
    expect(best).not.toContain('—');
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
  it('시작하면 3·2·1(1초씩)이 돌고 눈금 세 개가 이미 보이며 첫 번째가 지금 차례다', () => {
    open();
    script(SEQ_A);
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(states()).toEqual(['current', 'next', 'next']);
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(1000);
    expect(countdownValue()).toBeNull();
    expect(screen.getByRole('button', { name: '그만하기' })).toBeTruthy();
  });

  it('눈금에 뽑힌 목표의 순서가 보인다(1타 약 · 2타 강 · 3타 중)', () => {
    open();
    script(SEQ_A);
    clickStart();
    expect(gauge(0).textContent).toContain('1타');
    expect(gauge(0).querySelector('.mini-dyn-gauge-level')?.textContent).toBe('약');
    expect(gauge(1).querySelector('.mini-dyn-gauge-level')?.textContent).toBe('강');
    expect(gauge(2).querySelector('.mini-dyn-gauge-level')?.textContent).toBe('중');
  });

  it('카운트다운 중에 친 스네어는 세지 않는다(플레이가 시작돼도 하나도 끝나지 않는다)', () => {
    open();
    script(SEQ_A);
    clickStart();
    advance(1500);
    emit({ tHit: performance.now() });
    advance(500);
    emit({ tHit: performance.now() });
    expect(states()).toEqual(['current', 'next', 'next']);
    advance(1000);
    expect(states()).toEqual(['current', 'next', 'next']);
  });
});

describe('플레이', () => {
  it('머리 문구가 첫 목표의 말이고 아래 한 줄이 보인다', () => {
    open();
    toPlaying();
    expect(prompt()).toBe('이번엔 약하게.');
    expect(screen.getByText('밝은 띠 안에 들어오게 한 번 치세요.')).toBeTruthy();
    expect(status(0)?.textContent).toBe('지금 칠 차례');
    expect(status(1)?.textContent).toBe('다음');
  });

  it('단계마다 머리 문구가 다르다(강·중간)', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 45 });
    expect(prompt()).toBe('이번엔 강하게.');
    emit({ tHit: t0 + GAP * 2, velocity: 110 });
    expect(prompt()).toBe('이번엔 중간으로.');
  });

  it('시작 299ms 뒤의 타격은 무시하고 300ms 뒤는 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 299, velocity: 39 });
    expect(states()).toEqual(['current', 'next', 'next']);
    emit({ tHit: t0 + 300, velocity: 39 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('받은 타격은 실제 세기·목표·한 줄 평으로 보이고 다음 눈금이 지금 차례가 된다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 300, velocity: 39 });
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('39');
    expect(gauge(0).textContent).toContain('목표 45');
    expect(gauge(0).textContent).toContain('6 약했어요');
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(prompt()).toBe('이번엔 강하게.');
  });

  it('받은 타격에서 300ms가 안 지난 타격은 무시하고 지난 타격은 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 400, velocity: 39 });
    emit({ tHit: t0 + 400 + 299, velocity: 110 });
    expect(states()).toEqual(['done', 'current', 'next']);
    emit({ tHit: t0 + 400 + 300, velocity: 110 });
    expect(states()).toEqual(['done', 'done', 'current']);
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    const t0 = toPlaying();
    emit({ id: 77, tHit: t0 + GAP, velocity: 39 });
    emit({ id: 77, tHit: t0 + GAP, velocity: 39 });
    expect(states()).toEqual(['done', 'current', 'next']);
    // id가 다르면 따로 센다(같은 시각이라 보호 시간 때문에 받지는 않는다)
    emit({ id: 78, tHit: t0 + GAP, velocity: 39 });
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('키보드 스네어·패드 없음 타격은 세지 않고 안내도 없다', () => {
    open();
    const t0 = toPlaying();
    emit({ source: 'keyboard', tHit: t0 + GAP });
    expect(states()).toEqual(['current', 'next', 'next']);
    emit({ pad: null, tHit: t0 + GAP * 2 });
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(status(0)?.textContent).toBe('지금 칠 차례');
    expect(status(0)?.className).not.toContain('is-hint');
  });

  it('센서의 다른 패드(하이햇) 타격은 세지 않고 「스네어를 쳐 주세요」를 보였다가 1.5초 뒤 되돌린다', () => {
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
    emit({ tHit: t0 + GAP * 2, velocity: 39 });
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

describe('마무리와 결과', () => {
  it('세 번째 타격 → 「세 번 다 쳤어요.」, 지금 차례가 없고 더 쳐도 바뀌지 않으며 1.2초 뒤 결과가 뜬다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, REFERENCE);
    expect(prompt()).toBe('세 번 다 쳤어요.');
    expect(screen.queryByText('밝은 띠 안에 들어오게 한 번 치세요.')).toBeNull();
    expect(states()).toEqual(['done', 'done', 'done']);
    emit({ tHit: t0 + GAP * 5, velocity: 10 });
    expect(screen.getByTestId('mini-dyn-actual-2').textContent).toBe('73');
    advance(1199);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    advance(1);
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
    expect(screen.queryByTestId('mini-dyn-prompt')).toBeNull();
  });

  it('기준 예시: 목표 −6·+9·−2 → 94점, 행·메모·강조가 맞다', () => {
    open();
    playRound(REFERENCE);
    expect(headline()).toEqual(['94점.', '강한 타격이 조금 셌어요.']);
    expect(document.querySelector('.mini-score-value > span')?.textContent).toBe('94');
    expect(document.querySelector('.mini-score-unit')?.textContent).toBe('점');
    const label = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector('.mini-dyn-row-label')?.textContent;
    const actual = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`).querySelector('.mini-dyn-row-actual')?.textContent;
    expect([label(0), label(1), label(2)]).toEqual(['1타 · 약', '2타 · 강', '3타 · 중']);
    expect([actual(0), actual(1), actual(2)]).toEqual(['39', '119', '73']);
    expect([rowMeta(0)?.textContent, rowMeta(1)?.textContent, rowMeta(2)?.textContent]).toEqual([
      '목표 45 · 6 약함',
      '목표 110 · 9 셈',
      '목표 75 · 2 약함',
    ]);
    expect([rowScore(0), rowScore(1), rowScore(2)]).toEqual(['94점', '91점', '98점']);
    expect(rowMeta(0)?.className).not.toContain('is-warn');
    expect(rowMeta(1)?.className).toContain('is-warn');
    expect(rowMeta(2)?.className).not.toContain('is-warn');
  });

  it('세 번 다 딱 맞으면 100점이고 강조되는 행이 없다', () => {
    open();
    playRound([45, 110, 75]);
    expect(headline()).toEqual(['100점.', '세 번 모두 딱 맞았어요.']);
    expect(document.querySelector('.is-warn')).toBeNull();
    expect([rowScore(0), rowScore(1), rowScore(2)]).toEqual(['100점', '100점', '100점']);
  });

  it('가장 큰 차이가 13이면 한 줄 평에 「많이」가 들어간다', () => {
    open();
    playRound([45, 110, 62]);
    expect(headline()).toEqual(['96점.', '중간 타격이 많이 약했어요.']);
    expect(rowMeta(2)?.className).toContain('is-warn');
  });

  it('첫 기록: 「첫 기록이에요」와 「새 최고 기록」', () => {
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('첫 기록이에요');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
  });

  it('갱신: 「지난 최고 90점」과 「새 최고 기록」, 저장 값이 바뀐다', () => {
    seedBest(90);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('지난 최고 90점');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(94);
    expect(storedBest()?.at).not.toBe(SEED_AT);
  });

  it('동점: 「최고 기록과 같아요」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(94);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록과 같아요');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(94));
  });

  it('못 미침: 「최고 기록 96점」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(96);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록 96점');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(96));
  });
});

describe('저장', () => {
  it('첫 판의 저장 값은 단계·목표·실제 세기를 친 순서대로 담고, 화면을 다시 열면 안내 칸에 보인다', () => {
    const { unmount } = open();
    const t0 = toPlaying();
    hitAll(t0, REFERENCE);
    // 마무리 시간 동안에는 아직 쓰지 않는다
    expect(storedBest()).toBeNull();
    advance(1200);
    const saved = storedBest();
    expect(saved?.gameId).toBe('dynamics');
    expect(saved?.score).toBe(94);
    expect(typeof saved?.at).toBe('string');
    expect(saved?.detail).toEqual({
      shots: [
        { level: 'weak', target: 45, actual: 39 },
        { level: 'strong', target: 110, actual: 119 },
        { level: 'mid', target: 75, actual: 73 },
      ],
    });
    unmount();
    open();
    expect(introShown()).toBe(true);
    const best = cell('내 최고 기록');
    expect(best).toContain('94');
    expect(best).toContain('점');
  });

  it('로그인한 계정이면 그 계정의 키에 쓴다', () => {
    useAuth.setState({ status: 'authenticated', user: { id: 7 } as never });
    useMiniRecords.getState().reload();
    open();
    playRound(REFERENCE);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parseRecords(localStorage.getItem(`${STORAGE_KEY}.u7`)).dynamics?.score).toBe(94);
  });

  it('다른 게임(speed)의 저장된 기록은 건드리지 않는다', () => {
    const speed: MiniRecord = { gameId: 'speed', score: 61, at: SEED_AT, detail: { perSecond: [61, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed }));
    open();
    playRound(REFERENCE);
    const records = storedRecords();
    expect(records.speed).toEqual(speed);
    expect(records.dynamics?.score).toBe(94);
  });
});

describe('[다시 하기]', () => {
  it('결과가 뜰 때 [다시 하기]가 포커스를 받는다', () => {
    open();
    playRound(REFERENCE);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 하기' }));
  });

  it('목록을 거치지 않고 바로 카운트다운이 되고, 목표를 새로 뽑고, 이전 타격은 없다', () => {
    open();
    playRound(REFERENCE);
    script(SEQ_B);
    clickRetry();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(states()).toEqual(['current', 'next', 'next']);
    const levels = [0, 1, 2].map((i) => gauge(i).querySelector('.mini-dyn-gauge-level')?.textContent);
    expect(levels).toEqual(['약', '중', '강']);
    expect(screen.queryByTestId('mini-dyn-actual-0')).toBeNull();
    advance(3000);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(prompt()).toBe('이번엔 약하게.');
  });

  it('두 번째 판의 결과는 첫 판의 기록과 견준다', () => {
    open();
    playRound(REFERENCE);
    script(SEQ_B);
    clickRetry();
    advance(3000);
    const t0 = performance.now();
    hitAll(t0, [35, 70, 100]);
    advance(1200);
    expect(headline()).toEqual(['100점.', '세 번 모두 딱 맞았어요.']);
    expect(scoreNote()).toBe('지난 최고 94점');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(100);
  });
});

describe('[그만하기]와 화면 이탈', () => {
  it('플레이 중 [그만하기] → 안내로 돌아오고 기록이 남지 않으며 [시작하기]가 포커스를 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 39 });
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

  it('플레이 중 화면을 떠나면(언마운트) 기록이 남지 않는다', () => {
    const { unmount } = open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 39 });
    emit({ tHit: t0 + GAP * 2, velocity: 110 });
    unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('dynamics')).toBeNull();
  });

  it('그만둔 판 뒤에 끝까지 한 판을 하면 끝까지 한 판만 저장된다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 10 });
    clickQuit();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    playRound(REFERENCE);
    expect(headline()[0]).toBe('94점.');
    expect(storedBest()?.detail).toEqual({
      shots: [
        { level: 'weak', target: 45, actual: 39 },
        { level: 'strong', target: 110, actual: 119 },
        { level: 'mid', target: 75, actual: 73 },
      ],
    });
  });
});
