// @vitest-environment happy-dom
// CrescendoGamePage 검증(설계 MODE-006-minigame-crescendo 4절): 가짜 타이머로 한 판(카운트다운 3초 → 계단 오르기 → 마무리 1.5초 → 결과)을 끝까지 돌린다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { CrescendoGamePage } from '@/features/mini/CrescendoGamePage';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { velocityRatio } from '@/features/mini/domain/velocityShot';
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

/** 끝나기까지 3계단을 오른 뒤 49로 약하게 떨어지는 기준 판(세기 30·42·55·49) */
const REFERENCE = [30, 42, 55, 49];
/** 마무리(끝난 뒤 결과로 넘어가기까지) */
const CLOSING_MS = 1500;
/** 보호 시간(300ms)을 넘겨 치는 간격 */
const GAP = 400;

let nextId = 1;

/** 계단 `score`개짜리 저장 기록(세기 10부터 5씩 오르고 끝낸 타격은 5) */
function seedRecord(score: number): MiniRecord {
  return {
    gameId: 'crescendo',
    score,
    at: SEED_AT,
    detail: { steps: Array.from({ length: score }, (_, i) => 10 + i * 5), last: 5 },
  };
}

function seedBest(score: number) {
  localStorage.setItem(STORAGE_KEY, serializeRecords({ crescendo: seedRecord(score) }));
}

function storedRecords() {
  return parseRecords(localStorage.getItem(STORAGE_KEY));
}

function storedBest(): MiniRecord | null {
  return storedRecords().crescendo ?? null;
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
    <MemoryRouter initialEntries={['/play/mini/crescendo']}>
      <Routes>
        <Route path="/play/mini/crescendo" element={<CrescendoGamePage />} />
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
const introShown = () => screen.queryByText('칠 때마다 더 세게.') !== null;
const prompt = () => screen.getByTestId('mini-cres-prompt').textContent;
const count = () => screen.getByTestId('mini-cres-count').textContent;
const lastShown = () => screen.getByTestId('mini-cres-last');
const stepLines = () => screen.queryAllByTestId(/^mini-cres-step-/);
const fill = () => screen.queryByTestId('mini-cres-fill');
const fall = () => screen.queryByTestId('mini-cres-fall');
const wrongHint = () => screen.queryByText('스네어를 쳐 주세요');
const bars = () => screen.queryAllByTestId(/^mini-cres-bar-\d+$/);
const headline = () => Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent);
const scoreNote = () => document.querySelector('.mini-score-note')?.textContent ?? null;
const scoreLabel = () => document.querySelector('.mini-score-label')?.textContent ?? null;
const scoreValue = () => document.querySelector('.mini-score-value > span')?.textContent ?? null;
const scoreUnit = () => document.querySelector('.mini-score-value')?.textContent ?? null;
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

/** 카운트다운 3초를 지난다. 플레이가 시작된 순간(= 시작 시각)의 performance.now()를 돌려준다 */
function afterCountdown(): number {
  advance(3000);
  return performance.now();
}

/** [시작하기] → 카운트다운 3초 → 플레이 시작 시각 */
function toPlaying(): number {
  clickStart();
  return afterCountdown();
}

/** 시작 시각 뒤 GAP 간격으로 주어진 세기를 친다 */
function hitAll(t0: number, velocities: readonly number[]) {
  velocities.forEach((velocity, i) => emit({ tHit: t0 + GAP * (i + 1), velocity }));
}

/** 한 판을 끝까지: 주어진 세기를 차례로 치고 마무리(1.5초)를 지나 결과 화면까지 간다. `begin`은 판을 여는 동작([시작하기] 또는 [다시 하기]) */
function playRound(velocities: readonly number[], begin: () => void = clickStart) {
  begin();
  const t0 = afterCountdown();
  hitAll(t0, velocities);
  advance(CLOSING_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 1;
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
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useSettings.setState({ sensorKind: ORIGINAL_SENSOR_KIND });
  useLive.setState({ connected: [false, false], lastHit: null, hitSeq: 0 });
});

describe('안내 단계', () => {
  it('열면 안내 단계다: 작은 글·제목 두 줄·설명·칸 세 개', () => {
    open();
    expect(screen.getByText('어디까지 올라가는 거예요?')).toBeTruthy();
    expect(screen.getByText('약하게 시작해서')).toBeTruthy();
    expect(screen.getByText('칠 때마다 더 세게.')).toBeTruthy();
    expect(screen.getByText('앞에 친 것보다 조금이라도 세게 쳐야 이어져요. 같거나 약하면 끝나요.')).toBeTruthy();
    expect(cell('규칙')).toContain('점점 세게');
    expect(cell('규칙')).toContain('같거나 약하면 끝');
    expect(cell('치는 곳')).toContain('스네어');
    expect(cell('내 최고 기록')).not.toBeNull();
    expect(screen.queryByTestId('mini-cres-prompt')).toBeNull();
  });

  it('저장된 최고 기록이 없으면 「—」가 보인다', () => {
    open();
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('저장된 최고 기록이 있으면 「7번」이 보인다', () => {
    seedBest(7);
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('7');
    expect(best).toContain('번');
    expect(best).not.toContain('—');
  });

  it('센서가 없으면(none) [시작하기]가 꺼지고 사유가 보인다', () => {
    useSettings.setState({ sensorKind: 'none' });
    open();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.')).toBeTruthy();
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
  it('시작하면 3·2·1(1초씩)이 돌고 첫 타 전 화면이 이미 보인다', () => {
    open();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(prompt()).toBe('약하게 시작하세요.');
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(1000);
    expect(countdownValue()).toBeNull();
    expect(screen.getByRole('button', { name: '그만하기' })).toBeTruthy();
  });

  it('카운트다운 중에 친 스네어는 계단이 되지 않는다(플레이가 시작돼도 계단이 없다)', () => {
    open();
    clickStart();
    advance(1500);
    emit({ tHit: performance.now(), velocity: 50 });
    advance(500);
    emit({ tHit: performance.now(), velocity: 60 });
    expect(stepLines()).toHaveLength(0);
    advance(1000);
    expect(stepLines()).toHaveLength(0);
    expect(count()).toBe('0');
    expect(prompt()).toBe('약하게 시작하세요.');
  });
});

describe('첫 타 전 화면', () => {
  it('머리 「약하게 시작하세요.」, 아래 글, 횟수 0, 방금 친 세기 「—」이고 채움·계단이 없다', () => {
    open();
    toPlaying();
    expect(prompt()).toBe('약하게 시작하세요.');
    expect(screen.getByText('약할수록 오를 계단이 많아요.')).toBeTruthy();
    expect(count()).toBe('0');
    expect(lastShown().textContent).toBe('—');
    expect(lastShown().className).not.toContain('is-warn');
    expect(fill()).toBeNull();
    expect(stepLines()).toHaveLength(0);
    expect(fall()).toBeNull();
    expect(screen.getByTestId('mini-cres-ladder')).toBeTruthy();
  });
});

describe('치는 대로', () => {
  it('계단 선이 늘고 횟수·방금 친 세기·머리가 바뀌며 채움의 높이가 직전 계단을 따른다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 30 });
    expect(stepLines()).toHaveLength(1);
    expect(count()).toBe('1');
    expect(lastShown().textContent).toBe('30');
    expect(prompt()).toBe('30보다 세게.');
    expect(screen.getByText('조금만 더 세게 치세요.')).toBeTruthy();
    expect(screen.queryByText('약할수록 오를 계단이 많아요.')).toBeNull();
    expect(pct(fill()?.style.height)).toBeCloseTo(velocityRatio(30) * 100, 5);

    emit({ tHit: t0 + GAP * 2, velocity: 42 });
    expect(stepLines()).toHaveLength(2);
    expect(count()).toBe('2');
    expect(lastShown().textContent).toBe('42');
    expect(prompt()).toBe('42보다 세게.');
    expect(pct(fill()?.style.height)).toBeCloseTo(velocityRatio(42) * 100, 5);

    emit({ tHit: t0 + GAP * 3, velocity: 55 });
    expect(stepLines()).toHaveLength(3);
    expect(count()).toBe('3');
    expect(prompt()).toBe('55보다 세게.');
    expect(pct(fill()?.style.height)).toBeCloseTo(velocityRatio(55) * 100, 5);
    expect(screen.getByTestId('mini-cres-step-2').className).toContain('is-top');
    expect(screen.getByTestId('mini-cres-step-1').className).not.toContain('is-top');
    expect(fall()).toBeNull();
    expect(lastShown().className).not.toContain('is-warn');
  });

  it('직전보다 1만 세도 이어진다(41 → 42)', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [41, 42]);
    expect(count()).toBe('2');
    expect(prompt()).toBe('42보다 세게.');
  });
});

describe('판이 끝나는 경우', () => {
  it('직전과 같은 세기(30·42·42)로 치면 끝난다: 「42보다 세지 못했어요.」, 횟수 2, 방금 친 세기 42는 주의 색, 끝낸 타격 선', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42, 42]);
    expect(prompt()).toBe('42보다 세지 못했어요.');
    expect(count()).toBe('2');
    expect(lastShown().textContent).toBe('42');
    expect(lastShown().className).toContain('is-warn');
    expect(fall()).not.toBeNull();
    expect(pct(fall()?.style.bottom)).toBeCloseTo(velocityRatio(42) * 100, 5);
    expect(stepLines()).toHaveLength(2);
    // 끝난 판에도 채움은 마지막 계단까지 남고 머리 아래 글은 없다
    expect(pct(fill()?.style.height)).toBeCloseTo(velocityRatio(42) * 100, 5);
    expect(screen.queryByText('조금만 더 세게 치세요.')).toBeNull();
  });

  it('약하게 치면(30·42·55·49) 끝나고 횟수는 3이다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, REFERENCE);
    expect(prompt()).toBe('55보다 세지 못했어요.');
    expect(count()).toBe('3');
    expect(lastShown().textContent).toBe('49');
    expect(lastShown().className).toContain('is-warn');
    expect(pct(fall()?.style.bottom)).toBeCloseTo(velocityRatio(49) * 100, 5);
  });

  it('첫 타 다음에 바로 약하게 쳐도 끝나고 횟수는 1이다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [50, 20]);
    expect(prompt()).toBe('50보다 세지 못했어요.');
    expect(count()).toBe('1');
  });

  it('127을 치면 그 타격까지 세고 「꼭대기까지 올랐어요.」로 끝난다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 127]);
    expect(prompt()).toBe('꼭대기까지 올랐어요.');
    expect(count()).toBe('2');
    expect(lastShown().textContent).toBe('127');
    expect(lastShown().className).not.toContain('is-warn');
    expect(fall()).toBeNull();
    expect(pct(fill()?.style.height)).toBeCloseTo(100, 5);
    expect(screen.getByTestId('mini-cres-step-1').className).toContain('is-top');
  });

  it('첫 타가 127이어도 끝난다(횟수 1)', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [127]);
    expect(prompt()).toBe('꼭대기까지 올랐어요.');
    expect(count()).toBe('1');
    advance(CLOSING_MS);
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
    expect(storedBest()?.score).toBe(1);
  });
});

describe('받지 않는 타격(판을 끝내지도 않는다)', () => {
  it('받은 타격 뒤 299ms의 약한 타격은 받지 않고 판이 이어진다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 400, velocity: 50 });
    emit({ tHit: t0 + 400 + 299, velocity: 10 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
    expect(fall()).toBeNull();
    // 이어서 더 세게 치면 계단이 늘어난다
    emit({ tHit: t0 + 400 + 299 + 300, velocity: 60 });
    expect(count()).toBe('2');
  });

  it('받은 타격 뒤 300ms의 약한 타격은 받고, 앞보다 약하니 판이 끝난다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 400, velocity: 50 });
    emit({ tHit: t0 + 400 + 300, velocity: 10 });
    expect(prompt()).toBe('50보다 세지 못했어요.');
    expect(count()).toBe('1');
    expect(lastShown().textContent).toBe('10');
  });

  it('플레이 시작 뒤 299ms의 타격은 받지 않고 300ms의 타격은 받는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 299, velocity: 50 });
    expect(count()).toBe('0');
    expect(prompt()).toBe('약하게 시작하세요.');
    emit({ tHit: t0 + 300, velocity: 50 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
  });

  it('센서의 다른 패드 타격은 받지 않고 판을 끝내지도 않는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 50 });
    emit({ pad: 'HIHAT', tHit: t0 + GAP * 2, velocity: 10 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
    expect(fall()).toBeNull();
    emit({ tHit: t0 + GAP * 3, velocity: 60 });
    expect(count()).toBe('2');
  });

  it('패드 판정이 없는 타격(pad: null)은 받지 않고 판을 끝내지도 않으며 안내도 없다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 50 });
    emit({ pad: null, tHit: t0 + GAP * 2, velocity: 5 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
    expect(wrongHint()).toBeNull();
    emit({ tHit: t0 + GAP * 3, velocity: 60 });
    expect(count()).toBe('2');
  });

  it('키보드 소스 타격은 받지 않고 판을 끝내지도 않으며 안내도 없다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 50 });
    emit({ source: 'keyboard', tHit: t0 + GAP * 2, velocity: 5 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
    expect(wrongHint()).toBeNull();
    emit({ tHit: t0 + GAP * 3, velocity: 60 });
    expect(count()).toBe('2');
  });

  it('첫 타 전에 키보드 소스 타격이 와도 계단이 되지 않는다', () => {
    open();
    const t0 = toPlaying();
    emit({ source: 'keyboard', tHit: t0 + GAP, velocity: 64 });
    expect(count()).toBe('0');
    expect(prompt()).toBe('약하게 시작하세요.');
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    const t0 = toPlaying();
    emit({ id: 77, tHit: t0 + GAP, velocity: 50 });
    emit({ id: 77, tHit: t0 + GAP, velocity: 50 });
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
    expect(fall()).toBeNull();
  });
});

describe('다른 패드 안내', () => {
  it('센서의 다른 패드를 치면 「스네어를 쳐 주세요」가 보였다가 1.5초 뒤 사라지고 판은 이어진다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + GAP, velocity: 50 });
    emit({ pad: 'HIHAT', tHit: t0 + GAP * 2 });
    expect(wrongHint()).not.toBeNull();
    expect(screen.queryByText('조금만 더 세게 치세요.')).toBeNull();
    expect(count()).toBe('1');
    advance(1499);
    expect(wrongHint()).not.toBeNull();
    advance(1);
    expect(wrongHint()).toBeNull();
    expect(screen.getByText('조금만 더 세게 치세요.')).toBeTruthy();
    expect(count()).toBe('1');
  });

  it('첫 타 전에도 보이고 사라진다', () => {
    open();
    const t0 = toPlaying();
    emit({ pad: 'HIHAT', tHit: t0 + GAP });
    expect(wrongHint()).not.toBeNull();
    expect(screen.queryByText('약할수록 오를 계단이 많아요.')).toBeNull();
    advance(1500);
    expect(wrongHint()).toBeNull();
    expect(screen.getByText('약할수록 오를 계단이 많아요.')).toBeTruthy();
  });

  it('스네어를 치면 바로 사라지고 판은 이어진다', () => {
    open();
    const t0 = toPlaying();
    emit({ pad: 'HIHAT', tHit: t0 + GAP });
    expect(wrongHint()).not.toBeNull();
    emit({ tHit: t0 + GAP * 2, velocity: 50 });
    expect(wrongHint()).toBeNull();
    expect(count()).toBe('1');
    expect(prompt()).toBe('50보다 세게.');
  });

  it('패드 없음·키보드 타격은 안내를 띄우지 않는다', () => {
    open();
    const t0 = toPlaying();
    emit({ pad: null, tHit: t0 + GAP });
    emit({ source: 'keyboard', pad: 'HIHAT', tHit: t0 + GAP * 2 });
    expect(wrongHint()).toBeNull();
  });
});

describe('마무리(끝난 뒤 1.5초)', () => {
  it('1499ms까지는 플레이 화면 그대로이고 더 쳐도 바뀌지 않으며 1500ms에 결과가 뜬다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42, 42]);
    advance(CLOSING_MS - 1);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(prompt()).toBe('42보다 세지 못했어요.');
    expect(count()).toBe('2');
    // 마무리 중의 타격은 받지 않는다
    emit({ tHit: performance.now(), velocity: 100 });
    expect(count()).toBe('2');
    expect(stepLines()).toHaveLength(2);
    expect(lastShown().textContent).toBe('42');
    // 마무리 중에는 기록도 아직 쓰지 않는다
    expect(storedBest()).toBeNull();
    advance(1);
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
    expect(screen.queryByTestId('mini-cres-prompt')).toBeNull();
  });

  it('마무리 중에 친 타격은 결과에도 들어가지 않는다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42, 42]);
    advance(600);
    emit({ tHit: performance.now(), velocity: 120 });
    advance(CLOSING_MS - 600);
    expect(headline()[0]).toBe('2번.');
    expect(storedBest()?.score).toBe(2);
  });

  it('제한 시간이 없다: 한 타도 안 친 채 오래 두어도 판이 끝나지 않는다', () => {
    open();
    toPlaying();
    advance(120_000);
    expect(prompt()).toBe('약하게 시작하세요.');
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
  });
});

describe('결과', () => {
  it('30·42·55·49: 「3번.」·「마지막이 앞보다 6 약했어요.」, 점수 칸, 칸 3개, 막대 3개와 끝낸 타격 막대', () => {
    open();
    playRound(REFERENCE);
    expect(headline()).toEqual(['3번.', '마지막이 앞보다 6 약했어요.']);
    expect(scoreLabel()).toBe('이어 간 횟수');
    expect(scoreValue()).toBe('3');
    expect(scoreUnit()).toContain('번');
    expect(cell('시작 세기')).toContain('30');
    expect(cell('끝 세기')).toContain('55');
    expect(cell('평균 간격')).toContain('12.5');
    expect(screen.getByRole('heading', { name: '세기 계단' })).toBeTruthy();
    expect(bars()).toHaveLength(3);
    expect(screen.getByTestId('mini-cres-bar-fall')).toBeTruthy();
    expect(screen.getByTestId('mini-cres-bar-fall').textContent).toContain('49');
    expect(screen.getByTestId('mini-cres-bar-2').className).toContain('is-top');
  });

  it('30·42·42: 「2번.」·「마지막이 앞과 같았어요.」', () => {
    open();
    playRound([30, 42, 42]);
    expect(headline()).toEqual(['2번.', '마지막이 앞과 같았어요.']);
    expect(scoreValue()).toBe('2');
    expect(bars()).toHaveLength(2);
    expect(screen.getByTestId('mini-cres-bar-fall').textContent).toContain('42');
  });

  it('꼭대기로 끝난 판은 「꼭대기까지 올랐어요.」이고 끝낸 타격 막대가 없다', () => {
    open();
    playRound([30, 80, 127]);
    expect(headline()).toEqual(['3번.', '꼭대기까지 올랐어요.']);
    expect(bars()).toHaveLength(3);
    expect(screen.queryByTestId('mini-cres-bar-fall')).toBeNull();
    expect(cell('끝 세기')).toContain('127');
  });

  it('첫 타가 64 이상이면 한 줄 평이 「시작이 셌어요. 더 약하게 시작해 보세요.」다', () => {
    open();
    playRound([64, 70, 60]);
    expect(headline()).toEqual(['2번.', '시작이 셌어요. 더 약하게 시작해 보세요.']);
  });

  it('첫 타가 63이면 보통의 한 줄 평이다', () => {
    open();
    playRound([63, 70, 60]);
    expect(headline()[1]).toBe('마지막이 앞보다 10 약했어요.');
  });

  it('첫 기록: 「첫 기록이에요」와 「새 최고 기록」', () => {
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('첫 기록이에요');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
  });

  it('갱신(더 높음): 「지난 최고 2번」과 「새 최고 기록」, 저장 값이 바뀐다', () => {
    seedBest(2);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('지난 최고 2번');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(3);
    expect(storedBest()?.at).not.toBe(SEED_AT);
  });

  it('동점: 「최고 기록과 같아요」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(3);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록과 같아요');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(3));
  });

  it('못 미침(더 낮음): 「최고 기록 7번」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(7);
    open();
    playRound(REFERENCE);
    expect(scoreNote()).toBe('최고 기록 7번');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()).toEqual(seedRecord(7));
  });
});

describe('저장', () => {
  it('첫 판의 저장 값은 계단 수·받은 세기 목록·끝낸 타격의 세기를 담고, 화면을 다시 열면 안내 칸에 보인다', () => {
    const { unmount } = open();
    const t0 = toPlaying();
    hitAll(t0, REFERENCE);
    // 마무리 시간 동안에는 아직 쓰지 않는다
    expect(storedBest()).toBeNull();
    advance(CLOSING_MS);
    const saved = storedBest();
    expect(saved?.gameId).toBe('crescendo');
    expect(saved?.score).toBe(3);
    expect(typeof saved?.at).toBe('string');
    expect(saved?.detail).toEqual({ steps: [30, 42, 55], last: 49 });
    unmount();
    open();
    expect(introShown()).toBe(true);
    const best = cell('내 최고 기록');
    expect(best).toContain('3');
    expect(best).toContain('번');
  });

  it('꼭대기로 끝나면 detail.last가 null이다', () => {
    open();
    playRound([30, 80, 127]);
    expect(storedBest()?.score).toBe(3);
    expect(storedBest()?.detail).toEqual({ steps: [30, 80, 127], last: null });
  });

  it('로그인한 계정이면 그 계정의 키에 쓴다', () => {
    useAuth.setState({ status: 'authenticated', user: { id: 7 } as never });
    useMiniRecords.getState().reload();
    open();
    playRound(REFERENCE);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parseRecords(localStorage.getItem(`${STORAGE_KEY}.u7`)).crescendo?.score).toBe(3);
  });

  it('다른 게임(speed)의 저장된 기록은 건드리지 않는다', () => {
    const speed: MiniRecord = { gameId: 'speed', score: 61, at: SEED_AT, detail: { perSecond: [61, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed }));
    open();
    playRound(REFERENCE);
    const records = storedRecords();
    expect(records.speed).toEqual(speed);
    expect(records.crescendo?.score).toBe(3);
  });
});

describe('[다시 하기]', () => {
  it('결과가 뜰 때 [다시 하기]가 포커스를 받는다', () => {
    open();
    playRound(REFERENCE);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 하기' }));
  });

  it('목록을 거치지 않고 카운트다운부터 시작하고, 앞 판의 계단이 남지 않는다', () => {
    open();
    playRound(REFERENCE);
    clickRetry();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(prompt()).toBe('약하게 시작하세요.');
    expect(stepLines()).toHaveLength(0);
    expect(count()).toBe('0');
    expect(lastShown().textContent).toBe('—');
    advance(3000);
    expect(countdownValue()).toBeNull();
    expect(stepLines()).toHaveLength(0);
    expect(count()).toBe('0');
    expect(fall()).toBeNull();
  });

  it('두 번째 판의 결과가 첫 판의 기록과 견줘진다', () => {
    open();
    playRound(REFERENCE);
    // 첫 판 3번, 두 번째 판 4번(30·40·50·60·55)
    playRound([30, 40, 50, 60, 55], clickRetry);
    expect(headline()).toEqual(['4번.', '마지막이 앞보다 5 약했어요.']);
    expect(scoreNote()).toBe('지난 최고 3번');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(bars()).toHaveLength(4);
    expect(storedBest()?.score).toBe(4);
    expect(storedBest()?.detail).toEqual({ steps: [30, 40, 50, 60], last: 55 });
  });

  it('두 번째 판이 더 낮으면 첫 판의 기록이 그대로 남는다', () => {
    open();
    playRound(REFERENCE);
    playRound([30, 20], clickRetry);
    expect(headline()[0]).toBe('1번.');
    expect(scoreNote()).toBe('최고 기록 3번');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()?.score).toBe(3);
  });
});

describe('[그만하기]와 화면 이탈', () => {
  it('첫 타 전 [그만하기] → 안내로 돌아오고 기록이 남지 않으며 [시작하기]가 포커스를 받는다', () => {
    open();
    toPlaying();
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('crescendo')).toBeNull();
  });

  it('진행 중 [그만하기] → 기록이 남지 않고 [시작하기]가 포커스를 받는다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42]);
    expect(count()).toBe('2');
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('crescendo')).toBeNull();
  });

  it('화면을 떠나면(언마운트) 기록이 남지 않는다', () => {
    const first = open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42]);
    first.unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // 끝난 직후 마무리 중에 떠나도 남지 않는다
    const second = open();
    const t1 = toPlaying();
    hitAll(t1, [30, 42, 42]);
    advance(CLOSING_MS - 1);
    second.unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('crescendo')).toBeNull();
  });

  it('진행 중에 그만둔 뒤 다시 시작하면 계단이 비어 있다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [30, 42]);
    clickQuit();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    clickStart();
    expect(countdownValue()).toBe('3');
    expect(prompt()).toBe('약하게 시작하세요.');
    expect(stepLines()).toHaveLength(0);
    advance(3000);
    expect(stepLines()).toHaveLength(0);
    expect(count()).toBe('0');
    expect(prompt()).toBe('약하게 시작하세요.');
  });

  it('그만둔 판 뒤에 끝까지 한 판을 하면 그 판의 값만 저장된다', () => {
    open();
    const t0 = toPlaying();
    hitAll(t0, [90, 100]);
    clickQuit();
    playRound(REFERENCE);
    expect(headline()[0]).toBe('3번.');
    expect(storedBest()?.detail).toEqual({ steps: [30, 42, 55], last: 49 });
  });
});
