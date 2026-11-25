// @vitest-environment happy-dom
// TempoGamePage 검증(설계 MODE-006-minigame-tempo 4절): 가짜 타이머로 한 판을 끝까지 돌린다.
// 예비 박은 실제 예약기(tempoCountIn)가 울리고, 소리 엔진(audioEngine)만 바꿔 끼워 예약 시각을 읽는다.
// 타격은 실제 앱과 같은 길(useLive의 lastHit·hitSeq)로 넣고, 화면의 값은 data-testid와 글자로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { audioEngine } from '@/audio/AudioEngine';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { metronome } from '@/engine/Metronome';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { TempoGamePage } from '@/features/mini/TempoGamePage';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';

vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn() }));
vi.mock('@/runtime/hitSound', () => ({ setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));
vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: { click: vi.fn((atMs: number) => atMs), renderAheadMs: vi.fn(() => 0) },
}));
// 예약기가 쓰는 상수(LOOKAHEAD_MS·TICK_MS)는 그대로 두고 전역 메트로놈 객체만 바꾼다
vi.mock('@/engine/Metronome', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/Metronome')>()),
  metronome: { stop: vi.fn() },
}));

const STORAGE_KEY = 'ssaplash.mini.v1';
const SEED_AT = '2026-11-01T09:00:00.000Z';
/** 플레이가 시작되고 첫 예비 박까지 */
const LEAD_MS = 600;
const CLOSING_MS = 600;
const NOT_FINISHED_NOTE = '소리를 켜지 못해 시작하지 못했어요. 브라우저의 소리 설정을 확인해 주세요.';

let nextId = 1;
let randomSpy: MockInstance<() => number>;

const clickMock = () => vi.mocked(audioEngine.click);

function tempoRecord(score: number, bpm = 96): MiniRecord {
  return { gameId: 'tempo', score, at: SEED_AT, detail: { bpm, errors: [0, ...Array.from({ length: 15 }, () => score)] } };
}

/** 저장소에 최고 기록을 심는다(화면이 열릴 때 읽는다) */
function seedBest(score: number, bpm = 96) {
  localStorage.setItem(STORAGE_KEY, serializeRecords({ tempo: tempoRecord(score, bpm) }));
}

/** 저장소에 있는 「인간 메트로놈」 기록. 없으면 null */
type TempoRecord = Extract<MiniRecord, { gameId: 'tempo' }>;

function storedBest(): TempoRecord | null {
  return (parseRecords(localStorage.getItem(STORAGE_KEY)).tempo as TempoRecord | undefined) ?? null;
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

/** 가짜 시계를 `time`까지 보내고 그 시각에 친 타격을 넣는다. 이미 지난 시각이면 늦게 도착한 타격이다 */
function hitAt(time: number, pad?: PadId | null, id?: number) {
  const wait = time - performance.now();
  if (wait > 0) advance(wait);
  emit({ id, pad, tHit: time });
}

function open() {
  return render(
    <MemoryRouter initialEntries={['/play/mini/tempo']}>
      <Routes>
        <Route path="/play/mini/tempo" element={<TempoGamePage />} />
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
const count = () => text('mini-tempo-count');
const tag = () => text('mini-tempo-tag');
const bpmShown = () => Number(text('mini-tempo-bpm'));
const countdownValue = () => document.querySelector('.play-countdown-value')?.textContent ?? null;
const introShown = () => screen.queryByText('소리가 꺼져도') !== null;
const lastKeyboardDrum = () => vi.mocked(useKeyboardDrum).mock.lastCall?.[0];
const dots = () => Array.from(document.querySelectorAll('.mini-tempo-dot'));
const dotsOn = () => dots().filter((dot) => dot.getAttribute('data-state') === 'on').length;

/** 칸 하나의 전체 글자(라벨·값·단위·아래 한 줄). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

const scoreValue = () => document.querySelector('.mini-score-value')?.textContent ?? null;
const scoreNote = () => document.querySelector('.mini-score-note')?.textContent ?? null;
const headline = () => Array.from(document.querySelectorAll('.mini-headline span')).map((el) => el.textContent);
const chartHits = () => Array.from(document.querySelectorAll('[data-testid^="mini-tempo-hit-"]'));

interface Round {
  bpm: number;
  /** 박 간격(ms) */
  interval: number;
  /** 플레이가 시작된 시각 */
  startedAt: number;
  /** 마지막 예비 박을 울리는 시각 */
  lastClickAt: number;
}

/** 시작 → 카운트다운 3초 → 예비 박 여덟 번(마지막 박이 울린 순간까지). 측정은 아직 시작 전이다 */
function toLastClick(): Round {
  clickStart();
  const bpm = bpmShown();
  const interval = 60000 / bpm;
  advance(3000);
  const startedAt = performance.now();
  advance(LEAD_MS);
  for (let i = 1; i < 8; i += 1) advance(interval);
  return { bpm, interval, startedAt, lastClickAt: startedAt + LEAD_MS + 7 * interval };
}

/** 예비 박이 끝나고 측정이 시작된 순간까지. `measureFrom`은 그때부터 타격을 센다 */
function toMeasure(): Round & { measureFrom: number } {
  const round = toLastClick();
  advance(round.interval / 2);
  return { ...round, measureFrom: performance.now() };
}

/**
 * 측정이 시작된 뒤 16타를 친다: 첫 타를 기준으로 박 간격 격자 위에 `offsets[i]`만큼 벗어난 시각에.
 * 첫 타는 측정 시작 200ms 뒤. offsets[0]은 쓰지 않는다(기준이라 0)
 */
function playHits(round: ReturnType<typeof toMeasure>, offsets: readonly number[]) {
  const t0 = round.measureFrom + 200;
  offsets.forEach((offset, i) => hitAt(Math.round(t0 + i * round.interval) + (i === 0 ? 0 : offset)));
}

/** 16타를 치고 마무리 시간까지 흘려 결과 화면까지 간다 */
function playRound(offsets: readonly number[]) {
  const round = toMeasure();
  playHits(round, offsets);
  advance(CLOSING_MS);
  return round;
}

/** 모든 타를 정박에 */
const perfect = Array.from({ length: 16 }, () => 0);
/** 평균 절대 오차가 `score`가 되는 16타(첫 타는 기준) */
const meanOf = (score: number) => Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : i % 2 === 0 ? -score : score));
/** 끝으로 갈수록 빨라지는 16타(평균 오차 12ms, 마지막 타 −32ms) */
const SPEED_UP = [0, 6, -4, 6, -4, 6, -4, 6, -4, -8, -12, -16, -20, -24, -28, -32];

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.mocked(unlockAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSoundOnHit).mockReset();
  vi.mocked(useKeyboardDrum).mockReset();
  vi.mocked(metronome.stop).mockReset();
  clickMock().mockReset().mockImplementation((atMs?: number) => atMs ?? null);
  vi.mocked(audioEngine.renderAheadMs).mockReset().mockReturnValue(0);
  // 빠르기 뽑기: 0이면 80 BPM(직전 판이 없을 때)
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  randomSpy.mockRestore();
  vi.useRealTimers();
  localStorage.clear();
  useMiniRecords.setState({ owner: null, records: {} });
  useLive.setState({ connected: [false, false], lastHit: null, hitSeq: 0 });
});

describe('안내 단계', () => {
  it('열면 안내 단계다: 위 작은 글·제목 두 줄·칸 세 개·안내 한 줄', () => {
    const { container } = open();
    expect(container.querySelector('.mini-overline')?.textContent).toBe('인간 메트로놈');
    expect(screen.getByText('소리가 꺼져도')).toBeTruthy();
    expect(screen.getByText('같은 빠르기로 치세요.')).toBeTruthy();
    const hits = cell('한 판');
    expect(hits).toContain('16');
    expect(hits).toContain('타');
    expect(hits).toContain('예비 박 8개 뒤에 시작해요');
    expect(cell('재는 것')).toContain('평균 오차');
    expect(cell('내 최고 기록')).toContain('—');
    expect(screen.getByText('빠르기는 판마다 달라져요.')).toBeTruthy();
    expect(screen.queryByTestId('mini-tempo-count')).toBeNull();
  });

  it('저장된 최고 기록이 있으면 점수와 그때의 빠르기가 보인다', () => {
    seedBest(14, 96);
    open();
    const best = cell('내 최고 기록');
    expect(best).toContain('14ms');
    expect(best).toContain('96 BPM에서 세웠어요');
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

  it('열릴 때 전역 메트로놈이 울리고 있으면 멈춘다', () => {
    useLive.setState((s) => ({ metronome: { ...s.metronome, playing: true, locked: false } }));
    open();
    expect(metronome.stop).toHaveBeenCalledTimes(1);
  });

  it('울리고 있지 않으면 멈추지 않는다', () => {
    useLive.setState((s) => ({ metronome: { ...s.metronome, playing: false, locked: false } }));
    open();
    expect(metronome.stop).not.toHaveBeenCalled();
  });

  it('곡 연주에 묶인(locked) 메트로놈은 건드리지 않는다', () => {
    useLive.setState((s) => ({ metronome: { ...s.metronome, playing: true, locked: true } }));
    open();
    expect(metronome.stop).not.toHaveBeenCalled();
  });

  it('열면 친 드럼이 울리게 하고, 화면을 떠나면 끈다', () => {
    const { unmount } = open();
    expect(setSoundOnHit).toHaveBeenLastCalledWith(true);
    unmount();
    expect(setSoundOnHit).toHaveBeenLastCalledWith(false);
  });

  it('[시작하기]는 오디오 잠금을 푼다', () => {
    open();
    expect(unlockAudio).not.toHaveBeenCalled();
    clickStart();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });

  it('키보드 드럼은 안내 단계에서 꺼져 있다', () => {
    open();
    expect(lastKeyboardDrum()).toBe(false);
  });
});

describe('카운트다운과 예비 박', () => {
  it('카운트다운 3·2·1 동안 뒤에 빠르기와 「예비 박」이 보이고 박은 예약되지 않는다', () => {
    open();
    clickStart();
    expect(introShown()).toBe(false);
    expect(countdownValue()).toBe('3');
    expect(tag()).toBe('예비 박');
    expect(bpmShown()).toBe(80);
    expect(count()).toBe('0 / 8');
    expect(lastKeyboardDrum()).toBe(true);
    advance(1000);
    expect(countdownValue()).toBe('2');
    advance(1000);
    expect(countdownValue()).toBe('1');
    advance(999);
    expect(countdownValue()).toBe('1');
    expect(clickMock()).not.toHaveBeenCalled();
  });

  it('플레이가 시작되면 예비 박 여덟 개를 시작 + 600ms부터 박 간격으로 예약한다(강세·보통 ×3 두 번)', () => {
    open();
    const round = toLastClick();
    const calls = clickMock().mock.calls;
    expect(calls).toHaveLength(8);
    calls.forEach(([atMs], i) => {
      expect(atMs).toBeCloseTo(round.startedAt + LEAD_MS + i * round.interval, 3);
    });
    expect(calls.map(([, level]) => level)).toEqual(['accent', 'beat', 'beat', 'beat', 'accent', 'beat', 'beat', 'beat']);
  });

  it('박이 울릴 때마다 점이 하나씩 켜지고 「n / 8」이 늘어난다', () => {
    open();
    clickStart();
    const interval = 60000 / bpmShown();
    advance(3000);
    expect(count()).toBe('0 / 8');
    advance(LEAD_MS - 1);
    expect(count()).toBe('0 / 8');
    advance(1);
    expect(count()).toBe('1 / 8');
    expect(dotsOn()).toBe(1);
    for (let n = 2; n <= 8; n += 1) {
      advance(interval);
      expect(count()).toBe(`${n} / 8`);
      expect(dotsOn()).toBe(n);
    }
    expect(dots()).toHaveLength(8);
    expect(tag()).toBe('예비 박');
    expect(text('mini-tempo-headline')).toBe('박을 들어 보세요');
  });

  it('박마다 빠르기 숫자가 새로 그려진다(key가 바뀐다)', () => {
    open();
    clickStart();
    const interval = 60000 / bpmShown();
    advance(3000);
    advance(LEAD_MS);
    const first = screen.getByTestId('mini-tempo-bpm');
    advance(interval);
    const second = screen.getByTestId('mini-tempo-bpm');
    expect(second).not.toBe(first);
    expect(second.textContent).toBe(first.textContent);
  });

  it('카운트다운·예비 박 중에 친 타격은 세지 않는다', () => {
    open();
    clickStart();
    const interval = 60000 / bpmShown();
    advance(1500);
    emit({ tHit: performance.now() });
    advance(1500);
    advance(LEAD_MS);
    emit({ tHit: performance.now() });
    for (let i = 1; i < 8; i += 1) {
      advance(interval);
      emit({ tHit: performance.now() });
    }
    expect(count()).toBe('8 / 8');
    advance(interval / 2);
    expect(tag()).toBe('소리 꺼짐');
    expect(count()).toBe('0 / 16');
    // 측정이 시작된 뒤의 타격만 센다
    emit({ tHit: performance.now() + 10 });
    expect(count()).toBe('1 / 16');
  });

  it('마지막 예비 박 시각에 친 타격은 측정이 시작되기 전에 도착해도 세지 않고, 시작 시각의 타격은 센다', () => {
    open();
    const round = toLastClick();
    expect(tag()).toBe('예비 박');
    // 마지막 예비 박에 맞춰 같이 친 타격(측정 시작 반 박 전)
    emit({ tHit: round.lastClickAt });
    advance(round.interval / 2);
    expect(tag()).toBe('소리 꺼짐');
    expect(count()).toBe('0 / 16');
    const measureFrom = performance.now();
    // 시작 시각보다 이른 타격은 늦게 도착해도 세지 않는다
    emit({ tHit: measureFrom - 1 });
    expect(count()).toBe('0 / 16');
    // 시작 시각 그 자리의 타격은 센다
    emit({ tHit: measureFrom });
    expect(count()).toBe('1 / 16');
  });

  it('예비 박이 끝나기 전(마지막 박 뒤 반 박 안)에 도착한 타격도 시각이 측정 시작 뒤면 센다', () => {
    open();
    const round = toLastClick();
    const measureFrom = round.lastClickAt + round.interval / 2;
    // 아직 측정 시작 전에 도착했지만 시각은 시작 뒤(앞선 보정으로 시각이 뒤로 계산된 타격)
    emit({ tHit: measureFrom + 20, tRecv: measureFrom + 20 });
    expect(tag()).toBe('예비 박');
    advance(round.interval / 2);
    expect(tag()).toBe('소리 꺼짐');
    expect(count()).toBe('1 / 16');
  });

  it('예비 박이 끝나면 더는 박을 예약하지 않는다(측정이 끝나도 여덟 번뿐)', () => {
    open();
    const round = toMeasure();
    playHits(round, perfect);
    advance(CLOSING_MS);
    advance(10_000);
    expect(clickMock()).toHaveBeenCalledTimes(8);
  });
});

describe('측정', () => {
  it('측정이 시작되면 「소리 꺼짐」·「같은 빠르기로 치세요」·「0 / 16」이고 점 열여섯 개가 모두 꺼져 있다', () => {
    open();
    toMeasure();
    expect(tag()).toBe('소리 꺼짐');
    expect(text('mini-tempo-headline')).toBe('같은 빠르기로 치세요');
    expect(count()).toBe('0 / 16');
    expect(dots()).toHaveLength(16);
    expect(dotsOn()).toBe(0);
  });

  it('측정 중에는 오차도 「빠름」·「늦음」도 보이지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0);
    hitAt(t0 + round.interval + 30);
    hitAt(t0 + 2 * round.interval - 25);
    expect(count()).toBe('3 / 16');
    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain('빠름');
    expect(shown).not.toContain('늦음');
    expect(shown).not.toMatch(/\d\s*ms/);
  });

  it('타격을 셀 때마다 「n / 16」과 켜진 점이 늘어난다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    for (let n = 1; n <= 5; n += 1) {
      hitAt(t0 + (n - 1) * round.interval);
      expect(count()).toBe(`${n} / 16`);
      expect(dotsOn()).toBe(n);
    }
  });

  it('앞에서 센 타격과 박 간격의 40% 안에 온 타격은 세지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0);
    expect(count()).toBe('1 / 16');
    // 박 간격의 30%: 세게 친 뒤 튀어 오른 겹친 타격
    hitAt(t0 + round.interval * 0.3);
    expect(count()).toBe('1 / 16');
    // 박 간격의 45%는 센다
    hitAt(t0 + round.interval * 0.45);
    expect(count()).toBe('2 / 16');
  });

  it('패드가 판정되지 않은 타격은 세지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0, null);
    expect(count()).toBe('0 / 16');
    hitAt(t0 + round.interval);
    expect(count()).toBe('1 / 16');
  });

  it('같은 타격(id가 같음)이 두 번 들어와도 한 번만 센다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0, 'SNARE', 900);
    emit({ id: 900, tHit: t0 });
    expect(count()).toBe('1 / 16');
    hitAt(t0 + round.interval, 'SNARE', 901);
    expect(count()).toBe('2 / 16');
  });

  it('어느 패드든 센다(킥·하이햇 페달 포함)', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0, 'KICK');
    hitAt(t0 + round.interval, 'HIHAT_PEDAL');
    hitAt(t0 + 2 * round.interval, 'SNARE');
    expect(count()).toBe('3 / 16');
  });

  it('열여섯 번째 타를 세면 마무리로 넘어가 이후 타격은 받지 않고 키보드 드럼이 꺼진다', () => {
    open();
    const round = toMeasure();
    playHits(round, perfect);
    expect(count()).toBe('16 / 16');
    expect(tag()).toBe('소리 꺼짐');
    expect(lastKeyboardDrum()).toBe(false);
    emit({ tHit: performance.now() + 10 });
    expect(count()).toBe('16 / 16');
    expect(round.interval).toBeGreaterThan(0);
  });

  it('마무리 600ms가 지나면 결과가 뜬다(599ms에는 아직)', () => {
    open();
    const round = toMeasure();
    playHits(round, perfect);
    advance(CLOSING_MS - 1);
    expect(document.querySelector('.mini-result-hero')).toBeNull();
    expect(count()).toBe('16 / 16');
    advance(1);
    expect(document.querySelector('.mini-result-hero')).not.toBeNull();
    expect(screen.queryByTestId('mini-tempo-count')).toBeNull();
  });

  it('센 타격이 5초 동안 없으면 판이 끝나고 기록 없이 「0타에서 멈췄어요」가 보인다', () => {
    open();
    toMeasure();
    advance(4999);
    expect(tag()).toBe('소리 꺼짐');
    advance(1);
    advance(CLOSING_MS);
    expect(headline()).toEqual(['16타를 다 치지 못했어요.', '0타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.']);
    expect(scoreValue()).toBe('—');
    expect(document.querySelector('.mini-cells')).toBeNull();
    expect(document.querySelector('.mini-chart-panel')).toBeNull();
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('tempo')).toBeNull();
  });

  it('일곱 타를 치고 5초 조용하면 「7타에서 멈췄어요」이고 기록이 남지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    for (let i = 0; i < 7; i += 1) hitAt(t0 + i * round.interval);
    expect(count()).toBe('7 / 16');
    advance(5000);
    advance(CLOSING_MS);
    expect(headline()[0]).toBe('16타를 다 치지 못했어요.');
    expect(headline()[1]).toBe('7타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.');
    expect(scoreValue()).toBe('—');
    expect(document.querySelector('.mini-chart-panel')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('5초 제한은 타격을 셀 때마다 다시 잰다(4.9초 간격으로 쳐도 판이 이어진다)', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 4900;
    hitAt(t0);
    expect(count()).toBe('1 / 16');
    hitAt(t0 + 4900);
    expect(count()).toBe('2 / 16');
    hitAt(t0 + 9800);
    expect(count()).toBe('3 / 16');
    expect(tag()).toBe('소리 꺼짐');
    expect(document.querySelector('.mini-result-hero')).toBeNull();
    // 센 타격이 없는 5초가 지나면 끝난다
    advance(5000);
    advance(CLOSING_MS);
    expect(headline()[1]).toBe('3타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.');
  });

  it('세지 않은 타격(40% 안)은 5초 제한을 다시 재지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    hitAt(t0);
    // 4.9초 뒤에 겹친 타격은 세지 않으므로 처음 타격에서 5초가 지나면 끝난다
    hitAt(t0 + 4900, null);
    advance(100);
    advance(CLOSING_MS);
    expect(headline()[1]).toBe('1타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.');
  });
});

describe('결과', () => {
  it('박에 딱 맞게 친 판: 평균 0ms, 끝까지 빠르기를 지켰고 칸 셋과 그림 열여섯 개가 보인다', () => {
    open();
    const round = playRound(perfect);
    expect(headline()).toEqual(['평균 0ms 벗어났어요.', '끝까지 빠르기를 지켰어요.']);
    expect(document.querySelector('.mini-score-value > span')?.textContent).toBe('0');
    expect(document.querySelector('.mini-score-unit')?.textContent).toBe('ms');
    expect(document.querySelector('.mini-overline')?.textContent).toBe(`인간 메트로놈 · ${round.bpm} BPM`);
    const worst = cell('가장 벗어난 타');
    expect(worst).toContain('2');
    expect(worst).toContain('번째');
    expect(worst).toContain('정박');
    const end = cell('끝날 때 빠르기');
    expect(end).toContain(`${round.bpm}.0`);
    expect(end).toContain('BPM');
    expect(end).toContain(`제시한 빠르기 ${round.bpm}`);
    const steady = cell('흐름');
    expect(steady).toContain('고름');
    expect(steady).toContain('마지막 4타가 ±10ms 안이에요');
    expect(chartHits()).toHaveLength(16);
    const first = screen.getByTestId('mini-tempo-hit-0');
    expect(first.getAttribute('data-error')).toBe('0');
    expect(first.classList.contains('is-exact')).toBe(true);
    expect(screen.getByRole('heading', { name: '타격마다 벗어난 정도' })).toBeTruthy();
  });

  it('끝으로 갈수록 빨라진 판: 빨라졌다고 알리고 9번째 타격부터·가장 벗어난 16번째를 짚는다', () => {
    open();
    const round = playRound(SPEED_UP);
    expect(headline()).toEqual(['평균 12ms 벗어났어요.', '뒤로 갈수록 빨라졌어요.']);
    expect(document.querySelector('.mini-score-value > span')?.textContent).toBe('12');
    const flow = cell('흐름');
    expect(flow).toContain('빨라짐');
    expect(flow).toContain('9번째 타격부터');
    const worst = cell('가장 벗어난 타');
    expect(worst).toContain('16');
    expect(worst).toContain('번째');
    expect(worst).toContain('32ms 빠름');
    const end = cell('끝날 때 빠르기');
    const shownEnd = Number(/끝날 때 빠르기([\d.]+)BPM/.exec(end ?? '')?.[1]);
    expect(shownEnd).toBeGreaterThan(round.bpm);
    expect(end).toContain(`제시한 빠르기 ${round.bpm}`);
    expect(screen.getByTestId('mini-tempo-hit-15').getAttribute('data-error')).toBe('-32');
    expect(screen.getByTestId('mini-tempo-hit-15').classList.contains('is-early')).toBe(true);
  });

  it('끝으로 갈수록 느려진 판: 느려졌다고 알린다', () => {
    open();
    const round = playRound(SPEED_UP.map((offset) => -offset));
    expect(headline()).toEqual(['평균 12ms 벗어났어요.', '뒤로 갈수록 느려졌어요.']);
    const flow = cell('흐름');
    expect(flow).toContain('느려짐');
    expect(flow).toContain('9번째 타격부터');
    expect(cell('가장 벗어난 타')).toContain('32ms 늦음');
    const end = cell('끝날 때 빠르기');
    const shownEnd = Number(/끝날 때 빠르기([\d.]+)BPM/.exec(end ?? '')?.[1]);
    expect(shownEnd).toBeLessThan(round.bpm);
    expect(screen.getByTestId('mini-tempo-hit-15').classList.contains('is-late')).toBe(true);
  });

  it('박을 하나 건너뛰어도 그 뒤 타격의 오차가 한 박씩 밀리지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    // 다섯째 박을 비우고 열여섯 번 친다(박 0~4, 6~16)
    const beats = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const jitter = [0, 3, -2, 2, -3, 1, -1, 2, -2, 3, -3, 1, -1, 2, -2, 3];
    beats.forEach((beat, i) => hitAt(Math.round(t0 + beat * round.interval) + jitter[i]));
    advance(CLOSING_MS);
    expect(chartHits()).toHaveLength(16);
    for (const hit of chartHits()) {
      expect(Math.abs(Number(hit.getAttribute('data-error')))).toBeLessThanOrEqual(3);
    }
    expect(Number(scoreValue()?.replace('ms', ''))).toBeLessThanOrEqual(3);
    // 예비 박이 아니라 건너뛴 박이라서 마지막 타의 박은 16번이다
    expect(cell('흐름')).toContain('고름');
  });

  it('기록 문구: 첫 기록이면 「첫 기록이에요」와 「새 최고 기록」이 보인다', () => {
    open();
    playRound(meanOf(14));
    expect(scoreValue()).toBe('14ms');
    expect(scoreNote()).toBe('첫 기록이에요');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
  });

  it('기록 문구: 지난 최고보다 낮으면 「지난 최고 18ms」와 「새 최고 기록」, 저장 값이 바뀐다', () => {
    seedBest(18);
    open();
    const round = playRound(meanOf(14));
    expect(scoreNote()).toBe('지난 최고 18ms');
    expect(document.querySelector('.mini-pill-new')).not.toBeNull();
    expect(storedBest()?.score).toBe(14);
    expect(storedBest()?.detail.bpm).toBe(round.bpm);
    expect(storedBest()?.at).not.toBe(SEED_AT);
  });

  it('기록 문구: 같은 점수면 「최고 기록과 같아요」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(14);
    open();
    playRound(meanOf(14));
    expect(scoreNote()).toBe('최고 기록과 같아요');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()?.at).toBe(SEED_AT);
    expect(storedBest()?.detail.bpm).toBe(96);
  });

  it('기록 문구: 더 높으면 「최고 기록 14ms」, 표시 없음, 저장 값은 그대로', () => {
    seedBest(14);
    open();
    playRound(meanOf(20));
    expect(scoreValue()).toBe('20ms');
    expect(scoreNote()).toBe('최고 기록 14ms');
    expect(document.querySelector('.mini-pill-new')).toBeNull();
    expect(storedBest()?.score).toBe(14);
    expect(storedBest()?.at).toBe(SEED_AT);
  });

  it('저장되는 기록의 모양: 점수·빠르기·타격별 오차 16개(첫 값 0)', () => {
    open();
    const round = playRound(SPEED_UP);
    const saved = storedBest();
    expect(saved?.gameId).toBe('tempo');
    expect(saved?.score).toBe(12);
    expect(saved?.detail.bpm).toBe(round.bpm);
    expect(saved?.detail.bpm).toBe(bpmFromOverline());
    expect(saved?.detail.errors).toHaveLength(16);
    expect(saved?.detail.errors[0]).toBe(0);
    expect(saved?.detail.errors.every((error) => Number.isInteger(error))).toBe(true);
    expect(saved?.detail.errors).toEqual(SPEED_UP);
    expect(typeof saved?.at).toBe('string');
  });

  it('다른 게임의 기록은 건드리지 않는다', () => {
    const speed: MiniRecord = { gameId: 'speed', score: 68, at: SEED_AT, detail: { perSecond: [68, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    const sight: MiniRecord = {
      gameId: 'sight',
      variant: 'hint-off',
      score: 610,
      at: SEED_AT,
      detail: { problems: Array.from({ length: 10 }, () => ({ pad: 'SNARE' as const, ms: 610, wrongs: 0, timedOut: false })) },
    };
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed, 'sight:hint-off': sight }));
    open();
    playRound(meanOf(14));
    const stored = parseRecords(localStorage.getItem(STORAGE_KEY));
    expect(stored.speed).toEqual(speed);
    expect(stored['sight:hint-off']).toEqual(sight);
    expect(stored.tempo?.score).toBe(14);
  });

  it('결과가 뜨면 [다시 하기]가 포커스를 받는다', () => {
    open();
    playRound(perfect);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 하기' }));
  });

  it('[다시 하기]는 바로 카운트다운으로 가고, 빠르기는 직전 판과 다르며, 점은 0부터 센다', () => {
    // 난수가 같은 자리(0.5)를 가리켜도 직전 판의 빠르기는 고르지 않는다
    randomSpy.mockReturnValue(0.5);
    open();
    const round = playRound(perfect);
    clickRetry();
    expect(countdownValue()).toBe('3');
    expect(tag()).toBe('예비 박');
    expect(count()).toBe('0 / 8');
    expect(bpmShown()).not.toBe(round.bpm);
    // 둘째 판도 같은 방식으로 예비 박이 울린다
    clickMock().mockClear();
    advance(3000);
    advance(LEAD_MS);
    expect(count()).toBe('1 / 8');
    expect(clickMock().mock.calls.length).toBeGreaterThan(0);
  });

  it('[그만하기](예비 박 중)는 안내로 돌아가 더는 박을 예약하지 않고, 기록이 남지 않으며, [시작하기]가 포커스를 받는다', () => {
    open();
    clickStart();
    const interval = 60000 / bpmShown();
    advance(3000);
    advance(LEAD_MS + 2 * interval);
    expect(count()).toBe('3 / 8');
    clickQuit();
    expect(introShown()).toBe(true);
    expect(document.activeElement).toBe(startButton());
    const calls = clickMock().mock.calls.length;
    advance(10_000);
    expect(introShown()).toBe(true);
    expect(clickMock()).toHaveBeenCalledTimes(calls);
    expect(screen.queryByTestId('mini-tempo-count')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('tempo')).toBeNull();
  });

  it('[그만하기](측정 중)는 안내로 돌아가고 기록이 남지 않는다', () => {
    open();
    const round = toMeasure();
    const t0 = round.measureFrom + 200;
    for (let i = 0; i < 5; i += 1) hitAt(t0 + i * round.interval);
    clickQuit();
    expect(introShown()).toBe(true);
    advance(10_000);
    expect(introShown()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useMiniRecords.getState().best('tempo')).toBeNull();
  });

  it('[그만하기] 뒤 다시 시작하면 점이 0부터 시작한다', () => {
    open();
    const round = toMeasure();
    hitAt(round.measureFrom + 200);
    clickQuit();
    clickStart();
    expect(count()).toBe('0 / 8');
    advance(3000);
    advance(LEAD_MS);
    expect(count()).toBe('1 / 8');
  });

  it('플레이 중 화면을 떠나면(언마운트) 더는 박을 예약하지 않고 기록이 남지 않는다', () => {
    const { unmount } = open();
    clickStart();
    const interval = 60000 / bpmShown();
    advance(3000);
    advance(LEAD_MS + interval);
    unmount();
    const calls = clickMock().mock.calls.length;
    advance(10_000);
    expect(clickMock()).toHaveBeenCalledTimes(calls);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('소리를 켜지 못했을 때', () => {
  it('첫 박을 예약하지 못하면 안내로 돌아가 이유를 알리고 기록은 남지 않는다', () => {
    clickMock().mockImplementation(() => null);
    open();
    clickStart();
    advance(3000);
    expect(tag()).toBe('예비 박');
    advance(LEAD_MS);
    expect(introShown()).toBe(true);
    expect(screen.getByText(NOT_FINISHED_NOTE)).toBeTruthy();
    expect(screen.queryByText('빠르기는 판마다 달라져요.')).toBeNull();
    expect(document.activeElement).toBe(startButton());
    advance(10_000);
    expect(introShown()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('소리가 돌아오면 다시 시작해 안내 문구가 지워지고 정상으로 진행된다', () => {
    clickMock().mockImplementation(() => null);
    open();
    clickStart();
    advance(3000);
    advance(LEAD_MS);
    expect(screen.getByText(NOT_FINISHED_NOTE)).toBeTruthy();

    clickMock().mockReset().mockImplementation((atMs?: number) => atMs ?? null);
    clickStart();
    expect(countdownValue()).toBe('3');
    const round = toLastClickFromCountdown();
    expect(clickMock()).toHaveBeenCalledTimes(8);
    advance(round.interval / 2);
    expect(tag()).toBe('소리 꺼짐');
    clickQuit();
    expect(screen.queryByText(NOT_FINISHED_NOTE)).toBeNull();
    expect(screen.getByText('빠르기는 판마다 달라져요.')).toBeTruthy();
  });
});

describe('키보드 드럼', () => {
  it('치는 단계(카운트다운·플레이)에서만 켜지고 마무리·결과에서는 꺼진다', () => {
    open();
    expect(lastKeyboardDrum()).toBe(false);
    const round = toMeasure();
    expect(lastKeyboardDrum()).toBe(true);
    playHits(round, perfect);
    expect(lastKeyboardDrum()).toBe(false);
    advance(CLOSING_MS);
    expect(lastKeyboardDrum()).toBe(false);
  });
});

/** 이미 시작을 누른 뒤(카운트다운 중)부터 마지막 예비 박까지 */
function toLastClickFromCountdown(): Round {
  const bpm = bpmShown();
  const interval = 60000 / bpm;
  advance(3000);
  const startedAt = performance.now();
  advance(LEAD_MS);
  for (let i = 1; i < 8; i += 1) advance(interval);
  return { bpm, interval, startedAt, lastClickAt: startedAt + LEAD_MS + 7 * interval };
}

/** 결과 위 작은 글의 「… · {bpm} BPM」에서 빠르기를 읽는다 */
function bpmFromOverline(): number {
  return Number(/(\d+) BPM$/.exec(document.querySelector('.mini-overline')?.textContent ?? '')?.[1]);
}
