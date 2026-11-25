// @vitest-environment happy-dom
// SpeedGamePage 검증(설계 MODE-006-minigame-speed 4절): 가짜 타이머로 한 판을 끝까지 돌린다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { SpeedGamePage } from '@/features/mini/SpeedGamePage';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';

vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn() }));
vi.mock('@/runtime/hitSound', () => ({ setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));

const STORAGE_KEY = 'ssaplash.mini.v1';
/** 마지막에 고른 제한 시간의 저장 키 */
const SECONDS_KEY = 'ssaplash.mini.speedSeconds.v1';
const SEED_AT = '2026-11-01T09:00:00.000Z';

let nextId = 1;

function record(score: number): MiniRecord {
  return { gameId: 'speed', score, at: SEED_AT, detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
}

/** 저장소에 최고 기록을 심는다(화면이 열릴 때 읽는다) */
function seedBest(score: number) {
  localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: record(score) }));
}

/** 저장소에 있는 최고 기록. 저장된 것이 없으면 null */
function storedBest(): MiniRecord | null {
  return parseRecords(localStorage.getItem(STORAGE_KEY)).speed ?? null;
}

/** 5초 판 기록(갈래 `5s`, 초별 값 5개) */
function fiveRecord(score: number): MiniRecord {
  return { gameId: 'speed', variant: '5s', score, at: SEED_AT, detail: { perSecond: [score, 0, 0, 0, 0] } };
}

/** 저장소에 있는 5초 판 최고 기록. 없으면 null */
function storedFive(): MiniRecord | null {
  return parseRecords(localStorage.getItem(STORAGE_KEY))['speed:5s'] ?? null;
}

/** 타격 한 번을 실제 앱과 같은 길로 넣는다 */
function emit(over: { id?: number; pad?: PadId | null; tHit: number; tRecv?: number }) {
  const hit = {
    id: over.id ?? nextId++,
    stickId: null,
    pad: over.pad === undefined ? 'SNARE' : over.pad,
    velocity: 100,
    tHit: over.tHit,
    tRecv: over.tRecv ?? over.tHit,
  } as unknown as ResolvedHit;
  act(() => {
    useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
  });
}

/** 지금 이 순간 친 스네어 */
function snareNow() {
  const now = performance.now();
  emit({ tHit: now });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function open() {
  return render(
    <MemoryRouter initialEntries={['/play/mini/speed']}>
      <Routes>
        <Route path="/play/mini/speed" element={<SpeedGamePage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const startButton = () => screen.getByRole('button', { name: '시작하기' });
const clickStart = () => fireEvent.click(startButton());
const clickQuit = () => fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
const clickRetry = () => fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
const text = (id: string) => screen.getByTestId(id).textContent;
const count = () => text('mini-speed-count');
const countdownValue = () => document.querySelector('.play-countdown-value')?.textContent ?? null;
const introShown = () => screen.queryByText('10초 동안 스네어를') !== null;

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

/** 시작 → 카운트다운 3초. 플레이가 시작된 순간(= 시작 시각)의 performance.now()를 돌려준다 */
function toPlaying(): number {
  clickStart();
  advance(3000);
  return performance.now();
}

/**
 * 제한 시간 → 마무리 시간 순으로 두 번에 나눠 흘린다. 한 번에 10250ms를 흘리면 마무리 타이머가
 * 제한 시간이 끝난 시점(act 안)에 걸리지 못하고 act가 끝난 뒤에 걸려 250ms가 더 필요해진다(가짜 타이머 한정)
 */
function finishRound() {
  advance(10_000);
  advance(250);
}

/** 한 판을 끝까지: 시작 시각부터의 시각 목록대로 스네어를 치고 결과 화면까지 간다 */
function playRound(offsets: readonly number[]) {
  const t0 = toPlaying();
  for (const offset of offsets) emit({ tHit: t0 + offset });
  finishRound();
}

/** 타수 n개를 첫 3초 안에 흩어 둔 시각 목록 */
const spread = (n: number) => Array.from({ length: n }, (_, i) => 100 + i * 200);

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 1;
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
  useMiniRecords.setState({ owner: null, records: {} });
  useLive.setState({ connected: [true, false], lastHit: null, hitSeq: 0 });
  vi.mocked(unlockAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSoundOnHit).mockReset();
  vi.mocked(useKeyboardDrum).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useLive.setState({ connected: [false, false], lastHit: null, hitSeq: 0 });
});

describe('안내 단계', () => {
  it('열면 안내 단계다: 제목 두 줄과 칸 세 개', () => {
    open();
    expect(screen.getByText('10초 동안 스네어를')).toBeTruthy();
    expect(screen.getByText('가장 많이 치세요.')).toBeTruthy();
    expect(cell('제한 시간')).toContain('10');
    expect(cell('제한 시간')).toContain('초');
    expect(cell('세는 것')).toContain('스네어');
    expect(cell('내 최고 기록')).not.toBeNull();
    expect(screen.queryByTestId('mini-speed-count')).toBeNull();
  });

  it('저장된 최고 기록이 없으면 「—」가 보인다', () => {
    open();
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('저장된 최고 기록이 있으면 그 값과 단위가 보인다', () => {
    seedBest(68);
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('68');
    expect(best).toContain('타');
    expect(best).not.toContain('—');
  });

  it('스틱이 연결돼 있으면 연결 안내가 없다', () => {
    open();
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
  });

  it('스틱이 연결돼 있지 않으면 안내가 보이되 시작할 수 있다', () => {
    useLive.setState({ connected: [false, false] });
    open();
    expect(screen.getByText('스틱이 연결돼 있지 않아요')).toBeTruthy();
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
    clickStart();
    expect(countdownValue()).toBe('3');
  });

  it('왼쪽 스틱만 연결돼도 연결된 것으로 본다', () => {
    useLive.setState({ connected: [false, true] });
    open();
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
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
    // 거부된 Promise가 처리되도록 마이크로태스크를 비운다
    await act(async () => {
      await Promise.resolve();
    });
    expect(countdownValue()).toBe('3');
  });
});

describe('카운트다운과 플레이', () => {
  it('[시작하기] → 카운트다운 3·2·1(1초씩) → 플레이', () => {
    open();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(999);
    expect(countdownValue()).toBe('1');
    advance(1);
    expect(screen.getByRole('button', { name: '그만하기' })).toBeTruthy();
    expect(countdownValue()).toBe('시작!');
  });

  it('카운트다운 중에 친 스네어는 세지 않는다(플레이가 시작돼도 타수 0)', () => {
    open();
    clickStart();
    advance(1500);
    snareNow();
    advance(500);
    snareNow();
    expect(count()).toBe('0');
    advance(1000);
    expect(count()).toBe('0');
    // 이후 플레이 중의 타격은 센다
    snareNow();
    expect(count()).toBe('1');
  });

  it('받은 시각이 플레이 중이어도 타격 시각이 카운트다운 중이면 세지 않는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 - 30, tRecv: t0 + 20 });
    expect(count()).toBe('0');
  });

  it('안내 단계에서 친 타격은 세지 않는다', () => {
    open();
    snareNow();
    const t0 = toPlaying();
    expect(count()).toBe('0');
    emit({ tHit: t0 + 10 });
    expect(count()).toBe('1');
  });

  it('플레이 중에는 스네어 타격만 센다(다른 패드·패드 없음은 그대로)', () => {
    open();
    toPlaying();
    advance(500);
    snareNow();
    expect(count()).toBe('1');
    emit({ pad: 'HIHAT', tHit: performance.now() });
    expect(count()).toBe('1');
    emit({ pad: null, tHit: performance.now() });
    expect(count()).toBe('1');
    snareNow();
    expect(count()).toBe('2');
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    toPlaying();
    advance(500);
    const now = performance.now();
    emit({ id: 77, tHit: now });
    emit({ id: 77, tHit: now });
    expect(count()).toBe('1');
    // id가 다르면 같은 시각이어도 따로 센다
    emit({ id: 78, tHit: now });
    expect(count()).toBe('2');
  });

  it('남은 시간이 플레이 중 줄어든다(카운트다운 중 10.0, 3초 뒤 7.0)', () => {
    open();
    clickStart();
    expect(text('mini-speed-remaining')).toBe('10.0');
    advance(3000);
    expect(text('mini-speed-remaining')).toBe('10.0');
    advance(3000);
    expect(text('mini-speed-remaining')).toBe('7.0');
    advance(6900);
    expect(text('mini-speed-remaining')).toBe('0.1');
  });

  it('「지금 속도」는 최근 1초의 타수다', () => {
    open();
    const t0 = toPlaying();
    advance(3000);
    emit({ tHit: t0 + 1500 });
    emit({ tHit: t0 + 2100 });
    emit({ tHit: t0 + 2500 });
    expect(count()).toBe('3');
    // 지금은 3.0초째: (2.0, 3.0] 안의 두 번만 센다
    expect(text('mini-speed-rate')).toBe('2');
    advance(1000);
    // 4.0초째: (3.0, 4.0] 안에는 없다
    expect(text('mini-speed-rate')).toBe('0');
    expect(count()).toBe('3');
  });

  it('플레이가 시작되면 「시작!」이 보였다가 0.6초쯤 뒤 사라진다', () => {
    open();
    toPlaying();
    expect(screen.queryByText('시작!')).not.toBeNull();
    advance(500);
    expect(screen.queryByText('시작!')).not.toBeNull();
    advance(100);
    expect(screen.queryByText('시작!')).toBeNull();
  });

  it('제한 시간(10초)이 끝나면 「끝!」이 보인다', () => {
    open();
    toPlaying();
    advance(9900);
    expect(screen.queryByText('끝!')).toBeNull();
    advance(100);
    expect(screen.queryByText('끝!')).not.toBeNull();
    expect(text('mini-speed-remaining')).toBe('0.0');
  });
});

describe('늦게 도착한 타격', () => {
  it('끝난 뒤(마무리 250ms 안)에 도착했어도 타격 시각이 구간 안이면 센다', () => {
    open();
    const t0 = toPlaying();
    advance(10_000);
    advance(100);
    emit({ tHit: t0 + 9990, tRecv: performance.now() });
    expect(count()).toBe('1');
  });

  it('타격 시각이 구간 밖(끝난 뒤)이면 센다고 하지 않는다', () => {
    open();
    const t0 = toPlaying();
    advance(10_000);
    advance(100);
    emit({ tHit: t0 + 10_050, tRecv: performance.now() });
    emit({ tHit: t0 + 10_000, tRecv: performance.now() });
    expect(count()).toBe('0');
  });

  it('결과에서 늦게 도착한 타격이 타수에 들어가 있다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 4000 });
    advance(10_000);
    advance(50);
    emit({ tHit: t0 + 9990, tRecv: performance.now() });
    emit({ tHit: t0 + 10_100, tRecv: performance.now() });
    advance(200);
    expect(screen.getByText('10초에 2타.')).toBeTruthy();
  });
});

describe('결과 단계', () => {
  it('10초 + 250ms 뒤에 결과 화면이 된다', () => {
    open();
    toPlaying();
    advance(10_000);
    advance(249);
    expect(screen.queryByText('10초에 0타.')).toBeNull();
    expect(screen.queryByText('끝!')).not.toBeNull();
    advance(1);
    expect(screen.queryByText('끝!')).toBeNull();
    expect(screen.queryByTestId('mini-speed-count')).toBeNull();
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
  });

  it('첫 기록: 「10초에 N타.」「첫 기록이에요.」와 「새 최고 기록」', () => {
    open();
    playRound(spread(5));
    expect(screen.getByText('10초에 5타.')).toBeTruthy();
    expect(screen.getByText('첫 기록이에요.')).toBeTruthy();
    expect(screen.getByText('새 최고 기록')).toBeTruthy();
  });

  it('갱신: 「지난 기록보다 M타 많아요.」와 「새 최고 기록」', () => {
    seedBest(3);
    open();
    playRound(spread(5));
    expect(screen.getByText('10초에 5타.')).toBeTruthy();
    expect(screen.getByText('지난 기록보다 2타 많아요.')).toBeTruthy();
    expect(screen.getByText('새 최고 기록')).toBeTruthy();
  });

  it('동점: 「최고 기록과 같아요.」이고 「새 최고 기록」이 없다', () => {
    seedBest(5);
    open();
    playRound(spread(5));
    expect(screen.getByText('10초에 5타.')).toBeTruthy();
    expect(screen.getByText('최고 기록과 같아요.')).toBeTruthy();
    expect(screen.queryByText('새 최고 기록')).toBeNull();
  });

  it('못 미침: 「최고 기록까지 M타 남았어요.」이고 「새 최고 기록」이 없다', () => {
    seedBest(9);
    open();
    playRound(spread(5));
    expect(screen.getByText('10초에 5타.')).toBeTruthy();
    expect(screen.getByText('최고 기록까지 4타 남았어요.')).toBeTruthy();
    expect(screen.queryByText('새 최고 기록')).toBeNull();
  });

  it('0타: 안내 문구이고 「새 최고 기록」이 없다', () => {
    seedBest(9);
    open();
    playRound([]);
    expect(screen.getByText('스네어를 한 번도 못 쳤어요.')).toBeTruthy();
    expect(screen.getByText('스틱 연결과 스네어 위치를 확인해 보세요.')).toBeTruthy();
    expect(screen.queryByText('새 최고 기록')).toBeNull();
  });

  it('결과에 총 타수·「초당 N타」와 칸(초당 평균·가장 빨랐던 1초·최고 기록)이 보인다', () => {
    open();
    // 1초째 3번, 2초째 1번, 3초째 1번 → 5타, 초당 0.5, 가장 빨랐던 1초는 3타(1초째)
    playRound([100, 300, 600, 1500, 2500]);
    expect(document.querySelector('.mini-score-label')?.textContent).toBe('기록');
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('5타');
    expect(screen.getByText('초당 0.5타')).toBeTruthy();
    const average = cell('초당 평균');
    expect(average).toContain('0.5');
    expect(average).toContain('타');
    const fastest = cell('가장 빨랐던 1초');
    expect(fastest).toContain('3');
    expect(fastest).toContain('1초째');
    const best = cell('내 최고 기록');
    expect(best).toContain('5');
    expect(best).toContain('첫 기록');
    expect(screen.getByText('1초마다 친 횟수')).toBeTruthy();
  });

  it('최고 기록 칸이 판정에 맞는 한 줄을 보인다(갱신·동점·못 미침)', () => {
    seedBest(3);
    open();
    playRound(spread(5));
    expect(cell('지난 최고')).toContain('이번에 2타 넘었어요');
    cleanup();
    seedBest(5);
    open();
    playRound(spread(5));
    expect(cell('내 최고 기록')).toContain('이번 기록과 같아요');
    cleanup();
    seedBest(9);
    open();
    playRound(spread(5));
    expect(cell('내 최고 기록')).toContain('4타 모자랐어요');
  });

  it('0타 결과의 가장 빨랐던 1초는 0타', () => {
    open();
    playRound([]);
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('0타');
    expect(cell('가장 빨랐던 1초')).toContain('0');
  });
});

describe('저장', () => {
  it('첫 기록·갱신이면 결과가 확정될 때 localStorage에 쓰인다(계정 없음 키)', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    emit({ tHit: t0 + 1100 });
    advance(10_000);
    // 마무리 시간 동안에는 아직 쓰지 않는다
    expect(storedBest()).toBeNull();
    advance(250);
    const saved = storedBest();
    expect(saved?.score).toBe(2);
    expect(saved?.detail).toEqual({ perSecond: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('갱신하면 저장 값이 새 점수로 바뀐다', () => {
    seedBest(3);
    open();
    playRound(spread(5));
    expect(storedBest()?.score).toBe(5);
    expect(storedBest()?.at).not.toBe(SEED_AT);
  });

  it('동점이면 저장 값이 바뀌지 않는다', () => {
    seedBest(5);
    open();
    playRound(spread(5));
    expect(storedBest()).toEqual(record(5));
  });

  it('못 미쳐도 저장 값이 바뀌지 않는다', () => {
    seedBest(9);
    open();
    playRound(spread(5));
    expect(storedBest()).toEqual(record(9));
  });

  it('0타면 기록을 남기지 않는다(기록이 없었으면 저장소가 비어 있다)', () => {
    open();
    playRound([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('0타여도 이전 최고 기록은 그대로다', () => {
    seedBest(9);
    open();
    playRound([]);
    expect(storedBest()).toEqual(record(9));
  });

  it('로그인한 계정이면 그 계정의 키에 쓴다', () => {
    useAuth.setState({ status: 'authenticated', user: { id: 7 } as never });
    useMiniRecords.getState().reload();
    open();
    playRound(spread(4));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parseRecords(localStorage.getItem(`${STORAGE_KEY}.u7`)).speed?.score).toBe(4);
  });
});

describe('[다시 하기]', () => {
  it('목록을 거치지 않고 바로 카운트다운(숫자 3)이 되고 타수는 0으로 돌아간다', () => {
    open();
    playRound(spread(5));
    expect(screen.getByText('10초에 5타.')).toBeTruthy();
    clickRetry();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(count()).toBe('0');
    expect(text('mini-speed-remaining')).toBe('10.0');
  });

  it('두 번째 판의 결과는 첫 판의 기록과 견준다(못 미침)', () => {
    open();
    playRound(spread(5));
    clickRetry();
    const t0 = (advance(3000), performance.now());
    for (const offset of spread(3)) emit({ tHit: t0 + offset });
    finishRound();
    expect(screen.getByText('10초에 3타.')).toBeTruthy();
    expect(screen.getByText('최고 기록까지 2타 남았어요.')).toBeTruthy();
    expect(screen.queryByText('새 최고 기록')).toBeNull();
    expect(storedBest()?.score).toBe(5);
  });

  it('두 번째 판의 결과는 첫 판의 기록과 견준다(갱신)', () => {
    open();
    playRound(spread(5));
    clickRetry();
    const t0 = (advance(3000), performance.now());
    for (const offset of spread(7)) emit({ tHit: t0 + offset });
    finishRound();
    expect(screen.getByText('10초에 7타.')).toBeTruthy();
    expect(screen.getByText('지난 기록보다 2타 많아요.')).toBeTruthy();
    expect(screen.getByText('새 최고 기록')).toBeTruthy();
    expect(storedBest()?.score).toBe(7);
  });

  it('첫 판의 타수가 두 번째 판에 섞이지 않는다', () => {
    open();
    playRound(spread(5));
    clickRetry();
    advance(3000);
    expect(count()).toBe('0');
    finishRound();
    expect(screen.getByText('스네어를 한 번도 못 쳤어요.')).toBeTruthy();
  });
});

describe('[그만하기]와 화면 이탈', () => {
  it('카운트다운 중 [그만하기] → 안내 단계로 돌아오고 시간이 지나도 결과가 뜨지 않는다', () => {
    open();
    clickStart();
    advance(1000);
    clickQuit();
    expect(introShown()).toBe(true);
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('플레이 중 [그만하기] → 안내 단계로 돌아오고 기록이 남지 않으며 결과가 뜨지 않는다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    emit({ tHit: t0 + 200 });
    advance(2000);
    expect(count()).toBe('2');
    clickQuit();
    expect(introShown()).toBe(true);
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(screen.queryByText('새 최고 기록')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('speed')).toBeNull();
  });

  it('[그만하기]로 돌아오면 [시작하기]가 포커스를 받고, 다시 시작하면 타수가 0에서 시작한다', () => {
    open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    clickQuit();
    expect(document.activeElement).toBe(startButton());
    clickStart();
    expect(countdownValue()).toBe('3');
    expect(count()).toBe('0');
    advance(3000);
    expect(count()).toBe('0');
  });

  it('플레이 중 화면을 떠나면(언마운트) 기록이 남지 않는다', () => {
    const { unmount } = open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    emit({ tHit: t0 + 200 });
    advance(1000);
    unmount();
    advance(30_000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('speed')).toBeNull();
  });

  it('마무리 시간(끝!) 중 떠나도 기록이 남지 않는다', () => {
    const { unmount } = open();
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    advance(10_100);
    expect(screen.queryByText('끝!')).not.toBeNull();
    unmount();
    advance(1000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('키보드 드럼 스위치', () => {
  const lastActive = () => vi.mocked(useKeyboardDrum).mock.calls.at(-1)?.[0];

  it('카운트다운·플레이에서만 켜지고 안내·마무리·결과에서는 꺼져 있다', () => {
    open();
    expect(lastActive()).toBe(false);
    clickStart();
    expect(lastActive()).toBe(true);
    advance(3000);
    expect(lastActive()).toBe(true);
    advance(10_000);
    expect(screen.queryByText('끝!')).not.toBeNull();
    expect(lastActive()).toBe(false);
    advance(250);
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
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

describe('제한 시간 고르기 (설계 MODE-006-minigame-speed-ui)', () => {
  const secondsGroup = () => screen.getByRole('radiogroup', { name: '제한 시간' });
  const option = (label: string) => screen.getByRole('radio', { name: label });
  const pick = (label: string) => fireEvent.click(option(label));
  const checked = () =>
    Array.from(secondsGroup().querySelectorAll('[role="radio"]'))
      .filter((el) => el.getAttribute('aria-checked') === 'true')
      .map((el) => el.textContent);
  /** 5초 판의 제한 시간 → 마무리 시간 */
  const finishFive = () => {
    advance(5_000);
    advance(250);
  };

  it('안내에 5초·10초 세그먼트가 있고 처음에는 10초가 골라져 있다', () => {
    open();
    expect(Array.from(secondsGroup().querySelectorAll('[role="radio"]')).map((el) => el.textContent)).toEqual(['5초', '10초']);
    expect(checked()).toEqual(['10초']);
  });

  it('5초를 고르면 제목 첫 줄·제한 시간 칸·내 최고 기록 칸이 5초의 값으로 바뀐다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: record(68), 'speed:5s': fiveRecord(31) }));
    open();
    expect(cell('내 최고 기록')).toContain('68');
    pick('5초');
    expect(checked()).toEqual(['5초']);
    expect(screen.getByText('5초 동안 스네어를')).toBeTruthy();
    expect(screen.queryByText('10초 동안 스네어를')).toBeNull();
    expect(cell('제한 시간')).toContain('5초');
    expect(cell('내 최고 기록')).toContain('31');
    expect(cell('내 최고 기록')).not.toContain('68');
  });

  it('5초 기록이 없으면 10초 기록이 있어도 내 최고 기록 칸이 「—」다', () => {
    seedBest(68);
    open();
    pick('5초');
    expect(cell('내 최고 기록')).toContain('—');
  });

  it('고른 시간은 저장돼 다시 열어도 남아 있다', () => {
    const first = open();
    pick('5초');
    expect(localStorage.getItem(SECONDS_KEY)).toBe('5');
    first.unmount();
    open();
    expect(checked()).toEqual(['5초']);
    expect(screen.getByText('5초 동안 스네어를')).toBeTruthy();
  });

  it('저장 값이 모르는 값이면 10초다', () => {
    localStorage.setItem(SECONDS_KEY, '7');
    open();
    expect(checked()).toEqual(['10초']);
  });

  it('플레이 화면에는 세그먼트가 없다(시간은 안내에서만 바꾼다)', () => {
    open();
    toPlaying();
    expect(screen.queryByRole('radiogroup', { name: '제한 시간' })).toBeNull();
  });

  it('5초 판: 남은 시간이 5.0에서 시작하고 안내 문구가 5초를 말한다', () => {
    open();
    pick('5초');
    clickStart();
    expect(text('mini-speed-remaining')).toBe('5.0');
    expect(screen.getByText('「시작!」이 뜨면 5초가 흐릅니다.')).toBeTruthy();
    advance(3000);
    advance(2000);
    expect(text('mini-speed-remaining')).toBe('3.0');
  });

  it('5초 판: 시작부터 5초 미만의 타격만 세고 5초 + 250ms 뒤에 결과가 뜬다', () => {
    open();
    pick('5초');
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    emit({ tHit: t0 + 4999 });
    advance(5_000);
    // 5초가 지난 뒤에 친 타격(마무리 시간 안에 도착)은 세지 않는다
    emit({ tHit: t0 + 5000 });
    expect(screen.queryByText('끝!')).not.toBeNull();
    advance(249);
    expect(screen.queryByText('5초에 2타.')).toBeNull();
    advance(1);
    expect(screen.getByText('5초에 2타.')).toBeTruthy();
    expect(screen.getByText('첫 기록이에요.')).toBeTruthy();
  });

  it('5초 판 결과: 초당 평균은 다섯 초로 나누고 「5초 전체」, 초별 막대는 다섯 칸이다', () => {
    open();
    pick('5초');
    const t0 = toPlaying();
    for (const offset of [100, 300, 500, 1200, 4100]) emit({ tHit: t0 + offset });
    finishFive();
    expect(document.querySelector('.mini-score-value')?.textContent).toBe('5타');
    expect(cell('초당 평균')).toContain('1');
    expect(cell('초당 평균')).toContain('5초 전체');
    expect(cell('가장 빨랐던 1초')).toContain('3');
    expect(document.querySelectorAll('.mini-bars-chart .mini-bars-col')).toHaveLength(5);
    expect(Array.from(document.querySelectorAll('.mini-bars-axis span')).map((el) => el.textContent)).toEqual(['1초', '2초', '3초', '4초', '5초']);
    expect(screen.getByRole('img', { name: '1초마다 친 횟수: 3, 1, 0, 0, 1' })).toBeTruthy();
  });

  it('5초 기록은 `speed:5s`에 따로 저장되고 10초 기록은 그대로다', () => {
    seedBest(68);
    open();
    pick('5초');
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    emit({ tHit: t0 + 1100 });
    finishFive();
    expect(storedFive()?.score).toBe(2);
    expect(storedFive()?.variant).toBe('5s');
    expect(storedFive()?.detail).toEqual({ perSecond: [1, 1, 0, 0, 0] });
    expect(storedBest()?.score).toBe(68);
  });

  it('10초 판 기록에는 갈래가 붙지 않는다(저장 키·모양이 예전과 같다)', () => {
    open();
    playRound(spread(3));
    expect(storedBest()?.score).toBe(3);
    expect(storedBest()).not.toHaveProperty('variant');
    expect(storedFive()).toBeNull();
  });

  it('5초 판의 결과 문구는 5초 기록과 견준다(10초 기록이 더 커도 갱신이다)', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: record(68), 'speed:5s': fiveRecord(2) }));
    open();
    pick('5초');
    const t0 = toPlaying();
    for (const offset of [100, 300, 500]) emit({ tHit: t0 + offset });
    finishFive();
    expect(screen.getByText('5초에 3타.')).toBeTruthy();
    expect(screen.getByText('지난 기록보다 1타 많아요.')).toBeTruthy();
    expect(screen.getByText('새 최고 기록')).toBeTruthy();
    expect(storedFive()?.score).toBe(3);
    expect(storedBest()?.score).toBe(68);
  });

  it('[다시 하기]는 같은 시간(5초)으로 다시 한다', () => {
    open();
    pick('5초');
    const t0 = toPlaying();
    emit({ tHit: t0 + 100 });
    finishFive();
    clickRetry();
    expect(countdownValue()).toBe('3');
    expect(text('mini-speed-remaining')).toBe('5.0');
    const t1 = (advance(3000), performance.now());
    emit({ tHit: t1 + 100 });
    emit({ tHit: t1 + 200 });
    finishFive();
    expect(screen.getByText('5초에 2타.')).toBeTruthy();
  });

  it('[그만하기]로 돌아온 안내에 고른 시간이 그대로다', () => {
    open();
    pick('5초');
    toPlaying();
    clickQuit();
    expect(checked()).toEqual(['5초']);
    expect(screen.getByText('5초 동안 스네어를')).toBeTruthy();
  });
});

describe('플레이 화면의 모양 (설계 MODE-006-minigame-speed-ui)', () => {
  const ring = () => document.querySelector<HTMLElement>('.mini-speed-ring');
  const fill = () => document.querySelector<SVGCircleElement>('.mini-speed-ring-fill');
  const heat = () => [ring()?.getAttribute('data-heat'), ring()?.style.getPropertyValue('--heat-step')];
  /** 플레이 중 지금 시각에 스네어를 n번 친다 */
  const strike = (n: number) => {
    for (let i = 0; i < n; i += 1) snareNow();
  };

  it('게임 화면은 게임 색을 켜지 않는다(강조색은 메인 색이다)', () => {
    open();
    expect(document.querySelector('main')?.hasAttribute('data-game')).toBe(false);
    toPlaying();
    expect(document.querySelector('main')?.hasAttribute('data-game')).toBe(false);
    finishRound();
    expect(document.querySelector('main')?.hasAttribute('data-game')).toBe(false);
  });

  it('카운트다운 숫자·「시작!」·「끝!」은 고리 안에 겹친다', () => {
    open();
    clickStart();
    expect(ring()?.querySelector('.play-countdown-value')?.textContent).toBe('3');
    advance(3000);
    expect(ring()?.querySelector('.play-countdown-value')?.textContent).toBe('시작!');
    advance(10_000);
    expect(ring()?.querySelector('.mini-end-text')?.textContent).toBe('끝!');
  });

  it('남은 시간 고리: 카운트다운 중 가득, 플레이 중 제한 시간에 걸쳐 줄어들고, 끝나면 숨는다', () => {
    open();
    clickStart();
    expect(fill()?.classList.contains('is-running')).toBe(false);
    advance(3000);
    expect(fill()?.classList.contains('is-running')).toBe(true);
    expect(fill()?.classList.contains('is-empty')).toBe(false);
    expect(fill()?.style.transitionDuration).toBe('10000ms');
    advance(10_000);
    expect(fill()?.classList.contains('is-empty')).toBe(true);
  });

  it('5초 판의 고리는 5초에 걸쳐 줄어든다', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: '5초' }));
    toPlaying();
    expect(fill()?.style.transitionDuration).toBe('5000ms');
  });

  it('머리 줄의 보조 글이 그 판의 시간을 말한다', () => {
    open();
    toPlaying();
    expect(document.querySelector('.mini-stage-sub')?.textContent).toBe('10초 · 스네어');
  });

  it('카운트다운 중에는 타수와 남은 시간을 숨기고 무대 빛이 꺼져 있다가, 플레이가 시작되면 켜진다', () => {
    open();
    clickStart();
    expect(document.querySelector('.mini-count-value')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('.mini-speed-remain')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('.free-lights')?.classList.contains('is-on')).toBe(false);
    advance(3000);
    expect(document.querySelector('.free-lights')?.classList.contains('is-on')).toBe(true);
    // 「시작!」이 떠 있는 동안은 흐리게, 사라지면 또렷하게
    expect(document.querySelector('.mini-speed-remain')?.classList.contains('is-dim')).toBe(true);
    advance(700);
    expect(document.querySelector('.mini-count-value')?.className).toBe('mini-count-value');
    expect(document.querySelector('.mini-speed-remain')?.className).toBe('mini-speed-remain');
  });

  it('달아오름: 10타마다 칸이 오르고 50타·100타에서 단계가 바뀐다', () => {
    open();
    toPlaying();
    expect(heat()).toEqual(['0', '0']);
    strike(9);
    expect(heat()).toEqual(['0', '0']);
    strike(1);
    expect(heat()).toEqual(['0', '1']);
    strike(39);
    expect(heat()).toEqual(['0', '4']);
    expect(document.querySelector('.mini-speed-burst')).toBeNull();
    strike(1);
    expect(count()).toBe('50');
    expect(heat()).toEqual(['1', '0']);
    expect(document.querySelector('.mini-speed-burst')).not.toBeNull();
    strike(50);
    expect(heat()).toEqual(['2', '0']);
  });

  it('달아오름: 5초 판은 5타마다 칸이 오르고 25타에서 단계가 바뀐다', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: '5초' }));
    toPlaying();
    strike(5);
    expect(heat()).toEqual(['0', '1']);
    strike(20);
    expect(heat()).toEqual(['1', '0']);
  });

  it('[다시 하기]로 새 판을 시작하면 달아오름이 처음으로 돌아간다', () => {
    open();
    toPlaying();
    strike(60);
    expect(heat()).toEqual(['1', '1']);
    finishRound();
    clickRetry();
    expect(heat()).toEqual(['0', '0']);
  });

  it('울림 링: 타격이 있어야 생기고, 칸이 바뀌는 타격(10타째)은 굵다', () => {
    open();
    toPlaying();
    expect(document.querySelector('.mini-speed-pulse')).toBeNull();
    strike(9);
    expect(document.querySelector('.mini-speed-pulse')?.classList.contains('is-strong')).toBe(false);
    strike(1);
    expect(document.querySelector('.mini-speed-pulse')?.classList.contains('is-strong')).toBe(true);
  });

  it('초별 작은 막대: 칸 수가 초 수이고 지금 흐르는 초의 칸만 강조한다', () => {
    open();
    toPlaying();
    const bars = () => Array.from(document.querySelectorAll('.mini-bars-compact .mini-bar'));
    expect(bars()).toHaveLength(10);
    expect(bars().map((el) => el.classList.contains('is-now'))).toEqual([true, ...Array.from({ length: 9 }, () => false)]);
    advance(2100);
    expect(bars().findIndex((el) => el.classList.contains('is-now'))).toBe(2);
  });

  it('HUD의 최고 기록은 그 판의 제한 시간으로 세운 기록이다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: record(68), 'speed:5s': fiveRecord(31) }));
    open();
    fireEvent.click(screen.getByRole('radio', { name: '5초' }));
    toPlaying();
    const hud = Array.from(document.querySelectorAll('.mini-speed-hud-item')).map((el) => el.textContent);
    expect(hud[1]).toBe('최고 기록31타');
  });
});

describe('공용 타격음', () => {
  it('화면에 있는 동안 켜지고 떠나면 꺼진다', () => {
    const { unmount } = open();
    expect(setSoundOnHit).toHaveBeenCalledWith(true);
    expect(vi.mocked(setSoundOnHit).mock.calls.at(-1)).toEqual([true]);
    unmount();
    expect(vi.mocked(setSoundOnHit).mock.calls.at(-1)).toEqual([false]);
  });

  it('단계가 바뀌어도 켜 둔 채로 있다', () => {
    open();
    playRound(spread(2));
    expect(vi.mocked(setSoundOnHit).mock.calls).toEqual([[true]]);
  });
});
