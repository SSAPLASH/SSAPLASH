// @vitest-environment happy-dom
// OneShotGamePage 검증(설계 MODE-006-minigame-oneshot 4절): 가짜 타이머로 「정적 뒤 한 방」 한 판을 끝까지 돌린다.
// 음원 재생기(oneShotAudio)와 소리 엔진(audioEngine)은 바꿔 끼운다. 실제 음원은 받지 않는다.
// 소리 엔진의 시계는 화면 시계(performance.now)와 같게 두어, 노래 시작 = 플레이 시작 + 400ms로 읽는다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { audioEngine } from '@/audio/AudioEngine';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { metronome } from '@/engine/Metronome';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { ONE_SHOT_SONGS } from '@/features/mini/domain/oneShotSongs';
import { oneShotAudio } from '@/features/mini/oneShotAudio';
import { OneShotGamePage } from '@/features/mini/OneShotGamePage';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

vi.mock('@/config/miniOneShot', () => ({ ONE_SHOT_AUDIO_BASE: '/event-audio', ONE_SHOT_ENABLED: true }));
vi.mock('@/features/mini/oneShotAudio', () => ({
  oneShotAudio: { loadClip: vi.fn(), playHead: vi.fn(), playTail: vi.fn(), stop: vi.fn() },
}));
vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    perfToContextTime: (ms: number) => ms / 1000,
    contextToPerfTime: (sec: number) => sec * 1000,
    onStateChange: vi.fn(() => () => undefined),
  },
}));
vi.mock('@/engine/Metronome', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/Metronome')>()),
  metronome: { stop: vi.fn() },
}));
vi.mock('@/components/calibration/TimingCalDialog', () => ({
  TimingCalDialog: (props: { onClose: () => void }) => (
    <div data-testid="timing-dialog">
      <button onClick={props.onClose}>닫기</button>
    </div>
  ),
}));
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn() }));
vi.mock('@/runtime/hitSound', () => ({ setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));

const STORAGE_KEY = 'ssaplash.mini.v1';
const RECORD_KEY = 'oneshot:iwaly';
const NOW = '2026-11-24T12:00:00.000Z';
/** 4일 전(어느 시간대에서든 날짜 차이가 4일) */
const SEED_AT = '2026-11-20T12:00:00.000Z';
const SONG = ONE_SHOT_SONGS[0];
/** 플레이가 시작되고 노래가 시작될 때까지 */
const LEAD_MS = 400;
const CLOSING_MS = 1500;
const MINUS = '−';
const AUDIO_NOTE = '소리를 켜지 못해 시작하지 못했어요. 브라우저의 소리 설정을 확인해 주세요.';
const INTERRUPTED_NOTE = '소리가 끊겨서 판을 끝냈어요. 다시 시작해 주세요.';

type StateListener = Parameters<typeof audioEngine.onStateChange>[0];

let nextId = 1;
let clipBuffer: { duration: number };
let stateListener: StateListener | null = null;
const original = useSettings.getState();

type OneShotRecord = Extract<MiniRecord, { gameId: 'oneshot' }>;

function oneShotRecord(errorMs: number, at = SEED_AT): MiniRecord {
  return { gameId: 'oneshot', variant: 'iwaly', score: Math.abs(errorMs), at, detail: { errorMs } };
}

/** 저장소에 기록을 심는다(화면이 열릴 때 읽는다) */
function seed(records: Record<string, MiniRecord>) {
  localStorage.setItem(STORAGE_KEY, serializeRecords(records));
}

/** 저장소에 있는 「정적 뒤 한 방」 기록(곡 iwaly). 없으면 null */
function stored(): OneShotRecord | null {
  return (parseRecords(localStorage.getItem(STORAGE_KEY))[RECORD_KEY] as OneShotRecord | undefined) ?? null;
}

/** 타격 한 번을 실제 앱과 같은 길로 넣는다 */
function emit(over: { id?: number; pad?: PadId | null; tHit: number; foot?: number }) {
  const hit = {
    id: over.id ?? nextId++,
    stickId: null,
    pad: over.pad === undefined ? 'SNARE' : over.pad,
    source: 'keyboard',
    velocity: 100,
    tHit: over.tHit,
    tRecv: over.tHit,
    ...(over.foot === undefined ? {} : { foot: over.foot }),
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

/** 가짜 시계를 `time`까지 보내고 그 시각에 친 타격을 넣는다 */
function hitAt(time: number, over: { id?: number; pad?: PadId | null; foot?: number } = {}) {
  const wait = time - performance.now();
  if (wait > 0) advance(wait);
  emit({ ...over, tHit: time });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function open() {
  return render(
    <MemoryRouter initialEntries={['/play/mini/oneshot']}>
      <Routes>
        <Route path="/play/mini/oneshot" element={<OneShotGamePage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 열고 음원이 준비될 때까지 기다린다 */
async function openReady() {
  const view = open();
  await flush();
  return view;
}

const startButton = () => screen.getByRole('button', { name: '시작하기' }) as HTMLButtonElement;
const clickStart = () => fireEvent.click(startButton());
const clickQuit = () => fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
const clickRetry = () => fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
const countdownValue = () => document.querySelector('.play-countdown-value')?.textContent ?? null;
const lastKeyboardDrum = () => vi.mocked(useKeyboardDrum).mock.lastCall?.[0];
const introShown = () => screen.queryByText('노래가 멈춘 뒤') !== null;
const headlineEl = () => screen.getByTestId('mini-oneshot-headline');
const headlineLines = () => Array.from(headlineEl().querySelectorAll('span')).map((el) => el.textContent);
const verdict = () => screen.queryByTestId('mini-oneshot-verdict')?.textContent ?? null;
const resultTitle = () => Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent);
const scoreSpans = () => Array.from(document.querySelectorAll('.mini-score-value span')).map((el) => el.textContent);
const scoreNote = () => document.querySelector('.mini-score-note')?.textContent ?? null;
const tag = () => document.querySelector('.mini-pill-good, .mini-pill-bad')?.textContent ?? null;
const newPill = () => document.querySelector('.mini-pill-new');
const chartHit = () => screen.queryByTestId('mini-oneshot-hit');
const row = () => screen.getByTestId('mini-oneshot-row-iwaly');

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

interface Shot {
  startedAt: number;
  headAt: number;
  restAt: number;
  answerAt: number;
}

/** 시작 → 카운트다운 3초 → 노래 예약까지(노래는 400ms 뒤에 시작한다) */
function toSong(): Shot {
  clickStart();
  advance(3000);
  const startedAt = performance.now();
  advance(1);
  const headAt = startedAt + LEAD_MS;
  return { startedAt, headAt, restAt: headAt + SONG.restStartMs, answerAt: headAt + SONG.answerMs };
}

/** 노래를 시작 위치까지 보내고 한 타 친 뒤 판정 직후(마무리 단계)에 선다 */
function playShot(errorMs: number, over: { foot?: number } = {}): Shot {
  const shot = toSong();
  hitAt(shot.answerAt + errorMs, over);
  return shot;
}

/** 한 타를 치고 마무리 시간까지 흘려 결과 화면까지 간다 */
function playToResult(errorMs: number): Shot {
  const shot = playShot(errorMs);
  advance(CLOSING_MS);
  return shot;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
  nextId = 1;
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
  useMiniRecords.setState({ owner: null, records: {} });
  useLive.setState({
    connected: [true, false],
    lastHit: null,
    hitSeq: 0,
    metronome: { ...useLive.getState().metronome, playing: false, locked: false },
  });
  useSettings.setState({ sensorKind: 'none', audioOffsetMs: 0, kickOffsetMs: null, timingCal: null, timingCalPrompt: 'none' });
  clipBuffer = { duration: SONG.durationMs / 1000 };
  vi.mocked(oneShotAudio.loadClip).mockReset().mockResolvedValue(clipBuffer as unknown as AudioBuffer);
  vi.mocked(oneShotAudio.playHead)
    .mockReset()
    .mockImplementation((_buffer, startSec) => startSec);
  vi.mocked(oneShotAudio.playTail).mockReset();
  vi.mocked(oneShotAudio.stop).mockReset();
  stateListener = null;
  vi.mocked(audioEngine.onStateChange)
    .mockReset()
    .mockImplementation((listener: StateListener) => {
      stateListener = listener;
      return () => undefined;
    });
  vi.mocked(unlockAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSoundOnHit).mockReset();
  vi.mocked(useKeyboardDrum).mockReset();
  vi.mocked(metronome.stop).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useLive.setState({ connected: [false, false], lastHit: null, hitSeq: 0 });
  useSettings.setState({
    sensorKind: original.sensorKind,
    audioOffsetMs: original.audioOffsetMs,
    kickOffsetMs: original.kickOffsetMs,
    timingCal: original.timingCal,
    timingCalPrompt: original.timingCalPrompt,
  });
});

describe('안내 단계와 음원 받기', () => {
  it('열면 안내 단계다: 위 작은 글·제목 두 줄·칸 세 개·곡 한 줄(고르기 없음)', async () => {
    await openReady();
    expect(document.querySelector('.mini-overline')?.textContent).toBe('정적 뒤 한 방');
    expect(resultTitle()).toEqual(['노래가 멈춘 뒤', '돌아올 박에 한 방.']);
    const shots = cell('한 판');
    expect(shots).toContain('1');
    expect(shots).toContain('타');
    expect(cell('성공')).toContain('±80');
    expect(cell('성공')).toContain('ms');
    expect(cell('내 최고 기록')).toContain('—');
    expect(screen.getByTestId('mini-oneshot-song').textContent).toBe('I Will Always Love You · Whitney Houston');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('음원 주소(/event-audio/iwaly.wav)로 받는다', async () => {
    await openReady();
    expect(oneShotAudio.loadClip).toHaveBeenCalledTimes(1);
    expect(oneShotAudio.loadClip).toHaveBeenCalledWith('/event-audio/iwaly.wav', expect.any(AbortSignal));
  });

  it('받는 중에는 [시작하기]가 꺼져 있고 안내 글만 있다(옆에 버튼 없음)', () => {
    vi.mocked(oneShotAudio.loadClip).mockReturnValue(new Promise(() => undefined));
    open();
    expect(startButton().disabled).toBe(true);
    const msg = screen.getByText('음원을 불러오는 중이에요.').closest('.mini-intro-msg');
    expect(msg).not.toBeNull();
    expect(msg?.querySelector('button')).toBeNull();
  });

  it('길이가 맞는 음원이 오면 [시작하기]가 켜지고 안내 글이 사라진다', async () => {
    let resolve: (buffer: AudioBuffer) => void = () => undefined;
    vi.mocked(oneShotAudio.loadClip).mockReturnValue(new Promise<AudioBuffer>((r) => (resolve = r)));
    open();
    expect(startButton().disabled).toBe(true);
    resolve(clipBuffer as unknown as AudioBuffer);
    await flush();
    expect(startButton().disabled).toBe(false);
    expect(screen.queryByText('음원을 불러오는 중이에요.')).toBeNull();
  });

  it('길이가 50ms 안으로 다르면 받아들인다', async () => {
    clipBuffer.duration = (SONG.durationMs + 49) / 1000;
    await openReady();
    expect(startButton().disabled).toBe(false);
  });

  it('받지 못하면 [시작하기]가 꺼지고 「음원을 불러오지 못했어요.」와 [다시 시도]가 보인다', async () => {
    vi.mocked(oneShotAudio.loadClip).mockRejectedValue(new Error('network'));
    await openReady();
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText('음원을 불러오지 못했어요.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
  });

  it('[다시 시도]는 음원을 다시 받고, 성공하면 시작할 수 있다', async () => {
    vi.mocked(oneShotAudio.loadClip).mockRejectedValueOnce(new Error('network'));
    await openReady();
    expect(oneShotAudio.loadClip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await flush();
    expect(oneShotAudio.loadClip).toHaveBeenCalledTimes(2);
    expect(startButton().disabled).toBe(false);
    expect(screen.queryByText('음원을 불러오지 못했어요.')).toBeNull();
    clickStart();
    expect(countdownValue()).toBe('3');
  });

  it('길이가 50ms를 넘게 다르면 맞지 않는 음원으로 보고 시작을 막는다(버튼 없음)', async () => {
    clipBuffer.duration = (SONG.durationMs + 60) / 1000;
    await openReady();
    expect(startButton().disabled).toBe(true);
    const msg = screen.getByText('준비한 음원이 이 게임에 맞지 않아요. 음원 파일을 확인해 주세요.').closest('.mini-intro-msg');
    expect(msg).not.toBeNull();
    expect(msg?.querySelector('button')).toBeNull();
  });

  it('저장된 최고 기록이 있으면 내 최고 기록 칸에 값과 「늦음」이 보인다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(38) });
    await openReady();
    const best = cell('내 최고 기록');
    expect(best).toContain('38ms');
    expect(best).toContain('늦음');
    expect(best).not.toContain('—');
  });

  it('열릴 때 전역 메트로놈이 울리고 있으면 멈춘다', async () => {
    useLive.setState((s) => ({ metronome: { ...s.metronome, playing: true, locked: false } }));
    await openReady();
    expect(metronome.stop).toHaveBeenCalledTimes(1);
  });

  it('울리고 있지 않거나 곡 연주에 묶인(locked) 메트로놈은 건드리지 않는다', async () => {
    const { unmount } = await openReady();
    expect(metronome.stop).not.toHaveBeenCalled();
    unmount();
    useLive.setState((s) => ({ metronome: { ...s.metronome, playing: true, locked: true } }));
    await openReady();
    expect(metronome.stop).not.toHaveBeenCalled();
  });

  it('열면 친 드럼이 울리게 하고 떠나면 끈다. 떠날 때 재생기도 멈춘다', async () => {
    const { unmount } = await openReady();
    expect(setSoundOnHit).toHaveBeenLastCalledWith(true);
    expect(oneShotAudio.stop).not.toHaveBeenCalled();
    unmount();
    expect(setSoundOnHit).toHaveBeenLastCalledWith(false);
    expect(oneShotAudio.stop).toHaveBeenCalled();
  });

  it('[시작하기]는 오디오 잠금을 풀고, 키보드 드럼은 안내에서 꺼져 있다', async () => {
    await openReady();
    expect(lastKeyboardDrum()).toBe(false);
    expect(unlockAudio).not.toHaveBeenCalled();
    clickStart();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    expect(lastKeyboardDrum()).toBe(true);
  });
});

describe('박자 맞추기 권유', () => {
  it('센서 입력이고 기록·권유가 없으면 [시작하기]가 대화상자를 열고 시작하지 않는다', async () => {
    useSettings.setState({ sensorKind: 'webserial' });
    await openReady();
    clickStart();
    expect(screen.getByTestId('timing-dialog')).toBeTruthy();
    expect(introShown()).toBe(true);
    expect(countdownValue()).toBeNull();
    expect(oneShotAudio.playHead).not.toHaveBeenCalled();
    expect(unlockAudio).not.toHaveBeenCalled();
  });

  it('대화상자를 닫으면 권유를 건너뛴 것으로 남기고, 다시 [시작하기]를 누르면 시작한다', async () => {
    useSettings.setState({ sensorKind: 'webserial' });
    await openReady();
    clickStart();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('timing-dialog')).toBeNull();
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
    expect(countdownValue()).toBeNull();
    clickStart();
    expect(countdownValue()).toBe('3');
  });

  it('센서 입력이고 박자 맞추기를 안 했으면 안내에 한 줄과 [박자 맞추기]가 보이고 누르면 대화상자가 열린다', async () => {
    useSettings.setState({ sensorKind: 'webserial', timingCalPrompt: 'skipped' });
    await openReady();
    expect(screen.getByText('박자 맞추기를 아직 안 했어요. 오차가 실제와 다르게 나올 수 있어요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '박자 맞추기' }));
    expect(screen.getByTestId('timing-dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('timing-dialog')).toBeNull();
  });

  it('키보드 입력이면 그 한 줄이 없고 [시작하기]가 바로 시작한다', async () => {
    await openReady();
    expect(screen.queryByText('박자 맞추기를 아직 안 했어요. 오차가 실제와 다르게 나올 수 있어요.')).toBeNull();
    expect(screen.queryByRole('button', { name: '박자 맞추기' })).toBeNull();
    clickStart();
    expect(screen.queryByTestId('timing-dialog')).toBeNull();
    expect(countdownValue()).toBe('3');
  });
});

describe('카운트다운과 노래', () => {
  it('카운트다운 3·2·1 동안 타격은 아무 일도 없고 노래는 예약되지 않는다', async () => {
    await openReady();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(lastKeyboardDrum()).toBe(true);
    emit({ tHit: performance.now() });
    advance(1000);
    expect(countdownValue()).toBe('2');
    emit({ tHit: performance.now() });
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(999);
    expect(countdownValue()).toBe('1');
    expect(oneShotAudio.playHead).not.toHaveBeenCalled();
    expect(verdict()).toBeNull();
    expect(oneShotAudio.stop).not.toHaveBeenCalled();
  });

  it('카운트다운이 끝나면 앞부분을 한 번 예약한다: 시작 + 400ms 위치, 정답 위치까지', async () => {
    await openReady();
    const shot = toSong();
    expect(oneShotAudio.playHead).toHaveBeenCalledTimes(1);
    const [buffer, startSec, answerMs] = vi.mocked(oneShotAudio.playHead).mock.calls[0];
    expect(buffer).toBe(clipBuffer);
    expect(startSec).toBeCloseTo((shot.startedAt + LEAD_MS) / 1000, 6);
    expect(answerMs).toBe(SONG.answerMs);
    expect(countdownValue()).toBeNull();
  });

  it('노래가 흐르는 동안: 「잘 듣고 / 기다리세요」와 정적까지 움직이는 선', async () => {
    await openReady();
    toSong();
    expect(headlineLines()).toEqual(['잘 듣고', '기다리세요']);
    expect(headlineEl().classList.contains('is-plain')).toBe(true);
    expect(verdict()).toBeNull();
    const now = screen.getByTestId('mini-oneshot-now');
    expect(now.getAttribute('style')).toContain(`animation-duration: ${SONG.restStartMs}ms`);
  });

  it('노래가 시작되기 전(400ms 안)에 친 타격은 받지 않고 판이 이어진다', async () => {
    await openReady();
    const shot = toSong();
    hitAt(shot.startedAt + 200);
    hitAt(shot.headAt - 1);
    expect(verdict()).toBeNull();
    expect(headlineLines()).toEqual(['잘 듣고', '기다리세요']);
    expect(oneShotAudio.stop).not.toHaveBeenCalled();
    // 판이 이어져 정답 자리에 치면 성공한다
    hitAt(shot.answerAt);
    expect(headlineEl().textContent).toBe('0 ms');
    expect(verdict()).toBe('정박 · 성공');
  });

  it('정적이 시작되면 선이 사라지고 「딱 한 번 / 치세요」로 바뀐다', async () => {
    await openReady();
    const shot = toSong();
    advance(shot.restAt - performance.now() - 1);
    expect(screen.queryByTestId('mini-oneshot-now')).not.toBeNull();
    expect(headlineLines()).toEqual(['잘 듣고', '기다리세요']);
    advance(1);
    expect(screen.queryByTestId('mini-oneshot-now')).toBeNull();
    expect(headlineLines()).toEqual(['딱 한 번', '치세요']);
  });
});

describe('한 타', () => {
  it('노래가 도는 중(정적 전)에 치면 「정적 전에 쳤어요」: 소리를 멈추고 뒷부분은 틀지 않는다', async () => {
    await openReady();
    const shot = toSong();
    vi.mocked(oneShotAudio.stop).mockClear();
    hitAt(shot.restAt - 2000);
    expect(headlineEl().textContent).toBe('정적 전에 쳤어요');
    expect(headlineEl().classList.contains('is-bad')).toBe(true);
    expect(verdict()).toBeNull();
    expect(oneShotAudio.stop).toHaveBeenCalled();
    expect(oneShotAudio.playTail).not.toHaveBeenCalled();
    advance(CLOSING_MS);
    expect(tag()).toBe('실패');
    expect(resultTitle()).toEqual(['정적 전에 쳤어요.', '노래가 끊긴 뒤에 한 번만 치세요.']);
    expect(scoreSpans()).toEqual(['–']);
    expect(scoreNote()).toBe('잰 값이 없어요');
    expect(chartHit()).toBeNull();
    expect(newPill()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('정답 + 38ms에 치면 성공: 뒷부분을 바로 틀고 결과에 +38·늦음·기록이 남는다', async () => {
    await openReady();
    const shot = toSong();
    hitAt(shot.answerAt + 38);
    expect(headlineEl().textContent).toBe('+38 ms');
    expect(headlineEl().classList.contains('is-good')).toBe(true);
    expect(verdict()).toBe('늦음 · 성공');
    expect(oneShotAudio.playTail).toHaveBeenCalledTimes(1);
    expect(oneShotAudio.playTail).toHaveBeenCalledWith(clipBuffer, SONG.answerMs, SONG.tailMs);
    expect(stored()).toBeNull();
    advance(CLOSING_MS);
    expect(tag()).toBe('성공');
    expect(resultTitle()).toEqual(['38ms 늦었어요.', '노래가 돌아왔어요.']);
    expect(scoreSpans()).toEqual(['+38', 'ms']);
    expect(scoreNote()).toBe('늦음 · 허용 범위 80ms 안');
    expect(chartHit()?.getAttribute('data-offset')).toBe('38');
    expect(stored()).toMatchObject({ variant: 'iwaly', score: 38, detail: { errorMs: 38 } });
  });

  it.each([
    { error: 80, success: true },
    { error: 81, success: false },
    { error: -80, success: true },
    { error: -81, success: false },
  ])('경계: 오차 $error ms는 성공 여부 $success', async ({ error, success }) => {
    await openReady();
    playShot(error);
    const signed = error > 0 ? `+${error}` : `${MINUS}${Math.abs(error)}`;
    const side = error > 0 ? '늦음' : '빠름';
    expect(headlineEl().textContent).toBe(`${signed} ms`);
    expect(headlineEl().classList.contains(success ? 'is-good' : 'is-bad')).toBe(true);
    expect(verdict()).toBe(`${side} · ${success ? '성공' : '실패'}`);
    expect(vi.mocked(oneShotAudio.playTail).mock.calls).toHaveLength(success ? 1 : 0);
    if (!success) expect(oneShotAudio.stop).toHaveBeenCalled();
    advance(CLOSING_MS);
    expect(tag()).toBe(success ? '성공' : '실패');
    expect(scoreNote()).toBe(`${side} · 허용 범위 80ms ${success ? '안' : '밖'}`);
    if (!success) {
      expect(resultTitle()[1]).toBe('80ms 안에 쳐야 노래가 돌아와요.');
      expect(stored()).toBeNull();
    } else {
      expect(stored()?.score).toBe(80);
      expect(stored()?.detail.errorMs).toBe(error);
    }
  });

  it('정적 안이지만 한참 이른 타격은 정적 전이 아니라 큰 음수 오차의 실패다', async () => {
    await openReady();
    const shot = toSong();
    hitAt(shot.restAt + 100);
    const early = shot.restAt + 100 - shot.answerAt;
    expect(early).toBe(SONG.restStartMs + 100 - SONG.answerMs);
    expect(headlineEl().textContent).toBe(`${MINUS}${Math.abs(early)} ms`);
    expect(headlineEl().classList.contains('is-bad')).toBe(true);
    expect(verdict()).toBe('빠름 · 실패');
    expect(oneShotAudio.playTail).not.toHaveBeenCalled();
    advance(CLOSING_MS);
    expect(resultTitle()[0]).toBe(`${Math.abs(early)}ms 빨랐어요.`);
    expect(stored()).toBeNull();
  });

  it('정답 + 1000ms까지 치지 않으면 「치지 않았어요」: 결과에 기록이 남지 않는다', async () => {
    await openReady();
    const shot = toSong();
    advance(shot.answerAt + 1000 - performance.now() - 1);
    expect(verdict()).toBeNull();
    expect(headlineLines()).toEqual(['딱 한 번', '치세요']);
    advance(1);
    expect(headlineEl().textContent).toBe('치지 않았어요');
    expect(headlineEl().classList.contains('is-bad')).toBe(true);
    advance(CLOSING_MS);
    expect(tag()).toBe('실패');
    expect(resultTitle()).toEqual(['치지 않았어요.', '노래가 돌아올 자리에 한 번 치세요.']);
    expect(scoreSpans()).toEqual(['–']);
    expect(chartHit()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('정답 + 999ms의 타격은 아직 판정한다(실패, +999)', async () => {
    await openReady();
    playShot(999);
    expect(headlineEl().textContent).toBe('+999 ms');
    expect(verdict()).toBe('늦음 · 실패');
  });

  it('패드를 판정하지 못한 타격(pad: null)은 받지 않고 판이 이어진다', async () => {
    await openReady();
    const shot = toSong();
    hitAt(shot.answerAt, { pad: null });
    expect(verdict()).toBeNull();
    expect(headlineLines()).toEqual(['딱 한 번', '치세요']);
    expect(oneShotAudio.playTail).not.toHaveBeenCalled();
    hitAt(shot.answerAt + 10);
    expect(headlineEl().textContent).toBe('+10 ms');
  });

  it('처음 판정한 타격 하나만 센다: 뒤의 타격은 아무것도 바꾸지 않고, 같은 타격이 두 번 와도 한 번이다', async () => {
    await openReady();
    const shot = toSong();
    hitAt(shot.answerAt + 20, { id: 7 });
    hitAt(shot.answerAt + 20, { id: 7 });
    hitAt(shot.answerAt + 40, { id: 8 });
    expect(headlineEl().textContent).toBe('+20 ms');
    expect(oneShotAudio.playTail).toHaveBeenCalledTimes(1);
    advance(CLOSING_MS);
    hitAt(performance.now() + 1);
    expect(scoreSpans()).toEqual(['+20', 'ms']);
    expect(stored()?.score).toBe(20);
  });

  it('스틱 타격은 박자 맞추기 값(audioOffsetMs)만큼 빼서 잰다', async () => {
    useSettings.setState({ audioOffsetMs: 30 });
    await openReady();
    playShot(30);
    expect(headlineEl().textContent).toBe('0 ms');
    expect(verdict()).toBe('정박 · 성공');
  });

  it('발 타격은 킥 값(kickOffsetMs)을 뺀다', async () => {
    useSettings.setState({ audioOffsetMs: 30, kickOffsetMs: 50 });
    await openReady();
    playShot(50, { foot: 3 });
    expect(headlineEl().textContent).toBe('0 ms');
    expect(verdict()).toBe('정박 · 성공');
  });

  it('킥 값이 없으면 발 타격도 audioOffsetMs를 뺀다', async () => {
    useSettings.setState({ audioOffsetMs: 30, kickOffsetMs: null });
    await openReady();
    playShot(30, { foot: 3 });
    expect(headlineEl().textContent).toBe('0 ms');
  });

  it('판정 뒤는 마무리 단계: 타격은 받지 않고 키보드 드럼은 꺼지며, 1500ms 뒤 결과가 뜬다', async () => {
    await openReady();
    const shot = playShot(38);
    expect(lastKeyboardDrum()).toBe(false);
    expect(document.querySelector('.mini-result-hero')).toBeNull();
    advance(CLOSING_MS - 1);
    expect(document.querySelector('.mini-result-hero')).toBeNull();
    emit({ tHit: shot.answerAt + 2 });
    expect(headlineEl().textContent).toBe('+38 ms');
    expect(oneShotAudio.playTail).toHaveBeenCalledTimes(1);
    advance(1);
    expect(document.querySelector('.mini-result-hero')).not.toBeNull();
    expect(lastKeyboardDrum()).toBe(false);
  });
});

describe('기록과 결과', () => {
  it('처음 성공하면 「새 최고 기록」이 붙는다', async () => {
    await openReady();
    playToResult(38);
    expect(newPill()?.textContent).toBe('새 최고 기록');
  });

  it('저장된 기록보다 오차가 작으면 「새 최고 기록」이 붙고 저장 값이 바뀐다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(38) });
    await openReady();
    playToResult(20);
    expect(newPill()).not.toBeNull();
    expect(stored()).toMatchObject({ score: 20, detail: { errorMs: 20 } });
  });

  it('오차가 같으면(부호가 달라도) 표시도 갱신도 없다: 저장된 기록이 그대로다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(38) });
    await openReady();
    playToResult(-38);
    expect(tag()).toBe('성공');
    expect(newPill()).toBeNull();
    expect(stored()).toMatchObject({ score: 38, at: SEED_AT, detail: { errorMs: 38 } });
  });

  it('오차가 더 크면 표시도 갱신도 없다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(20) });
    await openReady();
    playToResult(50);
    expect(newPill()).toBeNull();
    expect(stored()).toMatchObject({ score: 20, at: SEED_AT });
  });

  it('실패한 판은 기록이 있어도 「새 최고 기록」이 없다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(38) });
    await openReady();
    playToResult(81);
    expect(tag()).toBe('실패');
    expect(newPill()).toBeNull();
    expect(stored()?.score).toBe(38);
  });

  it('곡별 기록: 이번 판이 세운 기록은 「38ms 늦음」과 「방금」', async () => {
    await openReady();
    playToResult(38);
    expect(row().textContent).toContain('I Will Always Love You');
    expect(row().textContent).toContain('38ms 늦음');
    expect(row().textContent).toContain('방금');
  });

  it('곡별 기록: 깨지 못한 옛 기록은 그 기록의 글과 「방금」이 아닌 때 글을 보인다', async () => {
    seed({ [RECORD_KEY]: oneShotRecord(20) });
    await openReady();
    playToResult(50);
    expect(row().textContent).toContain('20ms 늦음');
    expect(row().textContent).not.toContain('방금');
    expect(row().textContent).toContain('4일 전');
  });

  it('곡별 기록: 기록이 없으면 「기록 없음」', async () => {
    await openReady();
    playToResult(81);
    expect(row().textContent).toContain('기록 없음');
    expect(row().querySelector('.is-empty')).not.toBeNull();
    expect(row().textContent).not.toContain('방금');
  });

  it('곡이 하나뿐이라 [다른 곡]이 없다', async () => {
    await openReady();
    playToResult(38);
    expect(screen.queryByRole('button', { name: '다른 곡' })).toBeNull();
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
  });

  it('다른 게임(speed·tempo)의 저장된 기록은 건드리지 않는다', async () => {
    const speed: MiniRecord = {
      gameId: 'speed',
      score: 68,
      at: SEED_AT,
      detail: { perSecond: [68, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    };
    const tempo: MiniRecord = {
      gameId: 'tempo',
      score: 14,
      at: SEED_AT,
      detail: { bpm: 96, errors: [0, ...Array.from({ length: 15 }, () => 14)] },
    };
    seed({ speed, tempo });
    await openReady();
    playToResult(38);
    const all = parseRecords(localStorage.getItem(STORAGE_KEY));
    expect(all.speed).toEqual(speed);
    expect(all.tempo).toEqual(tempo);
    expect(all[RECORD_KEY]?.score).toBe(38);
  });

  it('[다시 하기]: 재생기를 멈추고 곧장 카운트다운으로 가며 음원은 다시 받지 않는다', async () => {
    await openReady();
    playToResult(81);
    expect(oneShotAudio.loadClip).toHaveBeenCalledTimes(1);
    vi.mocked(oneShotAudio.stop).mockClear();
    vi.mocked(oneShotAudio.playHead).mockClear();
    clickRetry();
    expect(oneShotAudio.stop).toHaveBeenCalled();
    expect(countdownValue()).toBe('3');
    expect(headlineLines()).toEqual(['잘 듣고', '기다리세요']);
    expect(verdict()).toBeNull();
    advance(3000);
    advance(1);
    expect(oneShotAudio.playHead).toHaveBeenCalledTimes(1);
    expect(oneShotAudio.loadClip).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mini-oneshot-now')).not.toBeNull();
  });

  it('[그만하기]: 노래 중에 누르면 재생기를 멈추고 안내로 돌아가 [시작하기]에 포커스가 간다. 기록은 없고 판정도 뜨지 않는다', async () => {
    await openReady();
    toSong();
    vi.mocked(oneShotAudio.stop).mockClear();
    clickQuit();
    expect(oneShotAudio.stop).toHaveBeenCalled();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    expect(stored()).toBeNull();
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(screen.queryByTestId('mini-oneshot-headline')).toBeNull();
    expect(stored()).toBeNull();
  });

  it('노래 중에 화면을 떠나면 재생기를 멈추고 기록은 없다', async () => {
    const { unmount } = await openReady();
    toSong();
    vi.mocked(oneShotAudio.stop).mockClear();
    unmount();
    expect(oneShotAudio.stop).toHaveBeenCalled();
    advance(30_000);
    expect(stored()).toBeNull();
  });
});

describe('끊김', () => {
  it('앞부분을 예약하지 못하면(playHead가 null) 안내로 돌아가 알리고, 다시 시작하면 글이 사라진다', async () => {
    vi.mocked(oneShotAudio.playHead).mockImplementationOnce(() => null);
    await openReady();
    clickStart();
    advance(3000);
    advance(1);
    expect(introShown()).toBe(true);
    expect(screen.getByText(AUDIO_NOTE)).toBeTruthy();
    expect(stored()).toBeNull();
    clickStart();
    expect(screen.queryByText(AUDIO_NOTE)).toBeNull();
    expect(countdownValue()).toBe('3');
  });

  it('노래 중에 오디오가 running이 아니게 되면 판을 버리고 안내로 돌아간다', async () => {
    await openReady();
    toSong();
    expect(stateListener).not.toBeNull();
    act(() => stateListener?.('running'));
    expect(introShown()).toBe(false);
    vi.mocked(oneShotAudio.stop).mockClear();
    act(() => stateListener?.('suspended'));
    expect(introShown()).toBe(true);
    expect(screen.getByText(INTERRUPTED_NOTE)).toBeTruthy();
    expect(oneShotAudio.stop).toHaveBeenCalled();
    advance(30_000);
    expect(introShown()).toBe(true);
    expect(stored()).toBeNull();
  });

  it('노래 중에 탭이 가려지면(visibilitychange) 판을 버리고 안내로 돌아간다', async () => {
    await openReady();
    toSong();
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(introShown()).toBe(true);
      expect(screen.getByText(INTERRUPTED_NOTE)).toBeTruthy();
    } finally {
      Reflect.deleteProperty(document, 'hidden');
    }
  });

  it('탭이 다시 보이는 변화(hidden=false)는 판을 끊지 않는다', async () => {
    await openReady();
    toSong();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(introShown()).toBe(false);
    expect(headlineLines()).toEqual(['잘 듣고', '기다리세요']);
  });
});
