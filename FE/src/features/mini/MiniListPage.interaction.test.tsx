// @vitest-environment happy-dom
// MiniListPage 검증: /play/mini의 고르기 카드 다섯(카탈로그 순서)과 큰 카드, 주소 값 `game`으로 고른 게임, 최고 기록 유무에 따른 문구, 저장소 읽기, 시작 이동.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MINI_PATH } from '@/domain/play/miniGame';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { MiniListPage } from '@/features/mini/MiniListPage';
import { useAuth } from '@/store/authStore';

// 「정적 뒤 한 방」 이벤트 스위치가 꺼진 빌드. 켜진 쪽은 MiniListPage.oneshot.interaction.test.tsx가 본다
vi.mock('@/config/miniOneShot', () => ({ ONE_SHOT_AUDIO_BASE: null, ONE_SHOT_ENABLED: false }));

const STORAGE_KEY = 'ssaplash.mini.v1';

/** 지금 주소(경로 + 주소 값)와 한 칸 뒤로 가는 버튼 */
function Where() {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="where">{l.pathname + l.search}</span>
      <button type="button" onClick={() => navigate(-1)}>
        뒤로
      </button>
    </div>
  );
}

/** entries의 마지막 주소에서 연다. 앞의 주소들은 그 전에 본 화면이다 */
function open(...entries: string[]) {
  const list = entries.length > 0 ? entries : [MINI_PATH];
  return render(
    <MemoryRouter initialEntries={list} initialIndex={list.length - 1}>
      <Where />
      <Routes>
        <Route path="/play/mini" element={<MiniListPage />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

function where(): string | null {
  return screen.getByTestId('where').textContent;
}

/** 고르기 카드 줄 */
function grid(): HTMLElement {
  return screen.getByRole('list', { name: '게임 고르기' });
}

function cards(): HTMLElement[] {
  return within(grid()).getAllByRole('button');
}

/** 이름으로 카드를 찾는다 */
function card(name: string): HTMLElement {
  const found = cards().find((el) => el.querySelector('.mini-card-name')?.textContent === name);
  if (!found) throw new Error(`카드가 없다: ${name}`);
  return found;
}

/** 고른 카드의 이름들 */
function pressed(): (string | null | undefined)[] {
  return cards()
    .filter((el) => el.getAttribute('aria-pressed') === 'true')
    .map((el) => el.querySelector('.mini-card-name')?.textContent);
}

/** 큰 카드 */
function hero(): HTMLElement {
  return document.querySelector('.mini-hero') as HTMLElement;
}

function heroName(): string | null {
  return within(hero()).getByRole('heading', { level: 3 }).textContent;
}

/** 큰 카드의 기록 줄(이름·값) */
function heroRows(): [string | null, string | null][] {
  return Array.from(hero().querySelectorAll('.mini-hero-row')).map((row) => [
    row.querySelector('dt')?.textContent ?? null,
    row.querySelector('dd')?.textContent ?? null,
  ]);
}

/** 카드 줄 안의 「아직 기록이 없어요」 수(큰 카드의 줄은 세지 않는다) */
function emptyCards(): number {
  return within(grid()).queryAllByText('아직 기록이 없어요').length;
}

function cardValues(): (string | null)[] {
  return Array.from(grid().querySelectorAll('.mini-card-value')).map((el) => el.textContent);
}

function speedRecord(score: number): MiniRecord {
  return { gameId: 'speed', score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
}

/** 「누구보다 빠르게」 5초 판 기록(갈래 `5s`, 초별 값 5개) */
function speedFiveRecord(score: number): MiniRecord {
  return { gameId: 'speed', variant: '5s', score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0] } };
}

function dynamicsRecord(score: number): MiniRecord {
  return {
    gameId: 'dynamics',
    score,
    at: '2026-11-24T10:00:00.000Z',
    detail: {
      feel: [42, 78, 109],
      shots: [
        { target: 52, actual: 46 },
        { target: 96, actual: 105 },
        { target: 74, actual: 76 },
      ],
    },
  };
}

function sightRecord(variant: 'hint-on' | 'hint-off', score: number): MiniRecord {
  return {
    gameId: 'sight',
    variant,
    score,
    at: '2026-11-24T10:00:00.000Z',
    detail: { problems: Array.from({ length: 10 }, () => ({ pad: 'SNARE' as const, ms: score, wrongs: 0, timedOut: false })) },
  };
}

function tempoRecord(score: number): MiniRecord {
  return { gameId: 'tempo', score, at: '2026-11-24T10:00:00.000Z', detail: { bpm: 96, errors: [0, ...Array.from({ length: 15 }, () => score)] } };
}

function crescendoRecord(score: number): MiniRecord {
  return {
    gameId: 'crescendo',
    score,
    at: '2026-11-24T10:00:00.000Z',
    detail: { steps: Array.from({ length: score }, (_, i) => 20 + i * 8), last: 20 },
  };
}

function reset() {
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
  useMiniRecords.setState({ owner: null, records: {} });
}

beforeEach(reset);
afterEach(() => {
  cleanup();
  reset();
});

describe('미니게임 목록: 구성', () => {
  it('카드가 다섯이고 카탈로그 순서대로 이름·규칙·꼬리표가 보인다', () => {
    open();
    expect(cards()).toHaveLength(5);
    const names = cards().map((el) => el.querySelector('.mini-card-name')?.textContent);
    expect(names).toEqual(['누구보다 빠르게', '강약중강약', '악보 보고 빨리 치기', '인간 메트로놈', '어디까지 올라가는 거예요?']);
    const rules = cards().map((el) => el.querySelector('.mini-card-rule')?.textContent);
    expect(rules).toEqual([
      '제한 시간 동안 스네어 가장 많이 치기',
      '내 세기를 재고 숫자에 맞춰 세 번 치기',
      '음표가 뜨면 맞는 패드를 바로 치기',
      '소리가 꺼져도 같은 빠르기로 치기',
      '앞 타격보다 조금씩 더 세게 치기',
    ]);
    const tags = cards().map((el) => el.querySelector('.mini-card-tag')?.textContent);
    expect(tags).toEqual(['5초 · 10초', '3타', '10문제', '16타', '약하면 끝']);
  });

  it('카드마다 자기 게임 id가 data-game에 실린다', () => {
    open();
    expect(cards().map((el) => el.getAttribute('data-game'))).toEqual(['speed', 'dynamics', 'sight', 'tempo', 'crescendo']);
  });

  it('큰 제목 두 줄과 설명 한 줄이 그대로 보인다', () => {
    open();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('가볍게 한 판?');
    expect(screen.getByText('한 판에 30초면 충분해요. 혼자 기록을 깨거나, 친구와 번갈아 겨뤄 보세요.')).toBeTruthy();
  });

  it('맨 위에 「← 리듬 게임」 링크(/play)가 있다', () => {
    open();
    expect(screen.getByRole('link', { name: '← 리듬 게임' }).getAttribute('href')).toBe('/play');
  });

  it('맨 아래에 기록 저장 안내 한 줄이 있다', () => {
    open();
    expect(screen.getByText('기록은 이 기기에 계정별로 저장돼요.')).toBeTruthy();
  });

  it('카드에는 [시작]이 없고, 시작 버튼은 큰 카드에 하나뿐이다', () => {
    open();
    expect(within(grid()).queryByText('시작')).toBeNull();
    expect(screen.getAllByRole('button', { name: /시작$/ })).toHaveLength(1);
    expect(hero().contains(screen.getByRole('button', { name: '누구보다 빠르게 시작' }))).toBe(true);
  });

  it('이벤트 스위치가 꺼져 있으면 「정적 뒤 한 방」 카드가 없다', () => {
    open();
    expect(cards()).toHaveLength(5);
    expect(screen.queryByText('정적 뒤 한 방')).toBeNull();
    expect(screen.queryByRole('button', { name: '정적 뒤 한 방 시작' })).toBeNull();
    expect(screen.queryByText('이벤트')).toBeNull();
  });
});

describe('미니게임 목록: 고른 게임', () => {
  it('주소 값이 없으면 목록 첫 게임이 큰 카드에 보이고 그 카드만 고른 상태다', () => {
    open();
    expect(heroName()).toBe('누구보다 빠르게');
    expect(hero().getAttribute('data-game')).toBe('speed');
    expect(pressed()).toEqual(['누구보다 빠르게']);
    // 열기만 해서는 주소를 고치지 않는다
    expect(where()).toBe('/play/mini');
  });

  it('카드를 누르면 큰 카드의 이름·꼬리표·규칙·설명이 그 게임 것으로 바뀌고 주소에 남는다', () => {
    open();
    fireEvent.click(card('인간 메트로놈'));
    expect(heroName()).toBe('인간 메트로놈');
    expect(hero().getAttribute('data-game')).toBe('tempo');
    expect(hero().querySelector('.mini-hero-tag')?.textContent).toBe('16타');
    expect(within(hero()).getByText('소리가 꺼져도 같은 빠르기로 치기')).toBeTruthy();
    expect(within(hero()).getByText(miniGameInfo('tempo').description)).toBeTruthy();
    expect(pressed()).toEqual(['인간 메트로놈']);
    expect(where()).toBe('/play/mini?game=tempo');
  });

  it('큰 카드의 그림도 고른 게임 것으로 바뀐다(큰 그림 하나)', () => {
    open();
    expect(hero().querySelectorAll('.mini-hero-art svg')).toHaveLength(1);
    expect(hero().querySelector('.mini-hero-art .mini-art-bar')).not.toBeNull();
    fireEvent.click(card('강약중강약'));
    expect(hero().querySelectorAll('.mini-hero-art svg')).toHaveLength(1);
    expect(hero().querySelector('.mini-hero-art .mini-art-dot')).not.toBeNull();
    expect(hero().querySelector('.mini-hero-art .mini-art-bar')).toBeNull();
  });

  it('카드를 차례로 눌러도 고른 카드는 늘 하나다', () => {
    open();
    fireEvent.click(card('강약중강약'));
    expect(pressed()).toEqual(['강약중강약']);
    fireEvent.click(card('악보 보고 빨리 치기'));
    expect(pressed()).toEqual(['악보 보고 빨리 치기']);
    expect(where()).toBe('/play/mini?game=sight');
    fireEvent.click(card('누구보다 빠르게'));
    expect(pressed()).toEqual(['누구보다 빠르게']);
    expect(where()).toBe('/play/mini?game=speed');
  });

  it('주소 값 game=tempo로 열면 「인간 메트로놈」이 고른 상태다', () => {
    open('/play/mini?game=tempo');
    expect(heroName()).toBe('인간 메트로놈');
    expect(pressed()).toEqual(['인간 메트로놈']);
  });

  it('모르는 값이면 첫 게임이 고른 상태이고 주소는 고치지 않는다', () => {
    open('/play/mini?game=ghost');
    expect(heroName()).toBe('누구보다 빠르게');
    expect(pressed()).toEqual(['누구보다 빠르게']);
    expect(where()).toBe('/play/mini?game=ghost');
  });

  it('이벤트 스위치가 꺼진 빌드에서 game=oneshot이면 첫 게임이 고른 상태다', () => {
    open('/play/mini?game=oneshot');
    expect(heroName()).toBe('누구보다 빠르게');
    expect(pressed()).toEqual(['누구보다 빠르게']);
    expect(screen.queryByText('정적 뒤 한 방')).toBeNull();
  });

  it('고를 때 다른 주소 값은 그대로 둔다', () => {
    open('/play/mini?from=home&game=speed');
    fireEvent.click(card('강약중강약'));
    expect(where()).toBe('/play/mini?from=home&game=dynamics');
  });

  it('고르는 동작은 방문 기록을 쌓지 않는다(뒤로 가면 들어오기 전 화면이다)', () => {
    open('/play', MINI_PATH);
    fireEvent.click(card('강약중강약'));
    fireEvent.click(card('인간 메트로놈'));
    expect(where()).toBe('/play/mini?game=tempo');
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(where()).toBe('/play');
  });
});

describe('미니게임 목록: 시작', () => {
  it('큰 카드의 [시작]을 누르면 고른 게임의 /play/mini/speed로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '누구보다 빠르게 시작' }));
    expect(where()).toBe('/play/mini/speed');
  });

  it.each([
    ['강약중강약', '/play/mini/dynamics'],
    ['악보 보고 빨리 치기', '/play/mini/sight'],
    ['인간 메트로놈', '/play/mini/tempo'],
    ['어디까지 올라가는 거예요?', '/play/mini/crescendo'],
  ])('「%s」 카드를 고른 뒤 [시작]을 누르면 %s로 간다', (name, path) => {
    open();
    fireEvent.click(card(name));
    fireEvent.click(screen.getByRole('button', { name: `${name} 시작` }));
    expect(where()).toBe(path);
  });

  it('카드를 두 번 누르면(더블클릭) 고르지 않았던 게임도 바로 시작한다', () => {
    open();
    fireEvent.doubleClick(card('악보 보고 빨리 치기'));
    expect(where()).toBe('/play/mini/sight');
  });

  it('시작은 방문 기록을 쌓는다(뒤로 가면 고른 게임 그대로인 목록이다)', () => {
    open();
    fireEvent.click(card('인간 메트로놈'));
    fireEvent.click(screen.getByRole('button', { name: '인간 메트로놈 시작' }));
    expect(where()).toBe('/play/mini/tempo');
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(where()).toBe('/play/mini?game=tempo');
    expect(heroName()).toBe('인간 메트로놈');
  });
});

describe('미니게임 목록: 큰 카드의 설명과 기록', () => {
  it.each(['speed', 'dynamics', 'sight', 'tempo', 'crescendo'] as const)('%s: 설명이 목록 표(안내 화면과 같은 글)와 글자까지 같다', (id) => {
    open(`/play/mini?game=${id}`);
    expect(hero().querySelector('.mini-hero-desc')?.textContent).toBe(miniGameInfo(id).description);
  });

  it('갈래가 없는 게임은 「최고 기록」 한 줄이고 기록이 없으면 「아직 기록이 없어요」', () => {
    open('/play/mini?game=tempo');
    expect(heroRows()).toEqual([['최고 기록', '아직 기록이 없어요']]);
  });

  it('갈래가 없는 게임에 기록이 있으면 그 줄에 값과 단위가 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ tempo: tempoRecord(14) }));
    open('/play/mini?game=tempo');
    expect(heroRows()).toEqual([['최고 기록', '14ms']]);
  });

  it('「누구보다 빠르게」는 10초·5초 두 줄이고 기록이 없으면 둘 다 비어 있다', () => {
    open();
    expect(heroRows()).toEqual([
      ['10초', '아직 기록이 없어요'],
      ['5초', '아직 기록이 없어요'],
    ]);
  });

  it('「누구보다 빠르게」의 갈래 없는 기록(예전 기록 포함)은 10초 줄에 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68) }));
    open();
    expect(heroRows()).toEqual([
      ['10초', '68타'],
      ['5초', '아직 기록이 없어요'],
    ]);
  });

  it('「누구보다 빠르게」에 두 시간의 기록이 다 있으면 두 줄 모두 값이 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), 'speed:5s': speedFiveRecord(36) }));
    open();
    expect(heroRows()).toEqual([
      ['10초', '68타'],
      ['5초', '36타'],
    ]);
  });

  it('「악보 보고 빨리 치기」는 힌트 끔·힌트 켬 두 줄이고 기록이 없는 줄만 비어 있다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420) }));
    open('/play/mini?game=sight');
    expect(heroRows()).toEqual([
      ['힌트 끔', '아직 기록이 없어요'],
      ['힌트 켬', '0.42초'],
    ]);
  });

  it('「악보 보고 빨리 치기」에 두 갈래 기록이 다 있으면 두 줄 모두 값이 보인다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420), 'sight:hint-off': sightRecord('hint-off', 610) }),
    );
    open('/play/mini?game=sight');
    expect(heroRows()).toEqual([
      ['힌트 끔', '0.61초'],
      ['힌트 켬', '0.42초'],
    ]);
  });

  it('다른 게임을 고르면 기록 줄도 그 게임 것으로 바뀐다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), tempo: tempoRecord(14) }));
    open();
    expect(heroRows()).toEqual([
      ['10초', '68타'],
      ['5초', '아직 기록이 없어요'],
    ]);
    fireEvent.click(card('인간 메트로놈'));
    expect(heroRows()).toEqual([['최고 기록', '14ms']]);
    fireEvent.click(card('강약중강약'));
    expect(heroRows()).toEqual([['최고 기록', '아직 기록이 없어요']]);
  });

  it('열려 있는 동안 스토어의 기록이 바뀌면 큰 카드와 카드가 같이 따라간다', () => {
    open();
    expect(heroRows()).toEqual([
      ['10초', '아직 기록이 없어요'],
      ['5초', '아직 기록이 없어요'],
    ]);
    expect(emptyCards()).toBe(5);
    act(() => {
      useMiniRecords.getState().submit(speedRecord(41));
    });
    expect(heroRows()).toEqual([
      ['10초', '41타'],
      ['5초', '아직 기록이 없어요'],
    ]);
    expect(cardValues()).toEqual(['41타']);
    expect(emptyCards()).toBe(4);
  });
});

describe('미니게임 목록: 카드의 최고 기록', () => {
  it('저장된 최고 기록이 없으면 다섯 카드 모두 「아직 기록이 없어요」', () => {
    open();
    expect(emptyCards()).toBe(5);
    expect(cardValues()).toEqual([]);
  });

  it('저장된 최고 기록이 있으면 값과 단위가 보인다(열릴 때 저장소에서 다시 읽는다)', () => {
    // 스토어는 이미 만들어져 비어 있다. 저장소에만 값을 넣어 두면 화면이 열릴 때 reload가 읽어 와야 보인다
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68) }));
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    open();
    expect(cardValues()).toEqual(['68타']);
    // 속도 카드는 값이 보이고, 나머지 네 카드는 비어 있다
    expect(emptyCards()).toBe(4);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(68);
  });

  it('두 게임의 기록이 있으면 카드마다 자기 최고 기록을 보인다(68타·오차 17)', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), dynamics: dynamicsRecord(17) }));
    open();
    expect(cardValues()).toEqual(['68타', '오차 17']);
    expect(emptyCards()).toBe(3);
  });

  it('다섯 게임의 기록이 모두 있으면 빈 카드가 없다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeRecords({
        speed: speedRecord(68),
        dynamics: dynamicsRecord(17),
        'sight:hint-off': sightRecord('hint-off', 610),
        tempo: tempoRecord(14),
        crescendo: crescendoRecord(9),
      }),
    );
    open();
    expect(cardValues()).toEqual(['68타', '오차 17', '0.61초', '14ms', '9번']);
    expect(emptyCards()).toBe(0);
  });

  it('인간 메트로놈: 기록이 있으면 그 카드만 ms 값을 보이고 나머지는 비어 있다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ tempo: tempoRecord(14) }));
    open();
    expect(card('인간 메트로놈').querySelector('.mini-card-value')?.textContent).toBe('14ms');
    expect(card('인간 메트로놈').textContent).not.toContain('아직 기록이 없어요');
    for (const el of cards().filter((c) => c !== card('인간 메트로놈'))) expect(el.textContent).toContain('아직 기록이 없어요');
  });

  it('악보 보고 빨리 치기: 두 갈래가 있으면 힌트 끔 기록을 갈래 이름 없이 보인다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420), 'sight:hint-off': sightRecord('hint-off', 610) }),
    );
    open();
    const sight = card('악보 보고 빨리 치기');
    expect(sight.querySelector('.mini-card-value')?.textContent).toBe('0.61초');
    expect(sight.querySelector('.mini-card-variant')).toBeNull();
    expect(sight.textContent).not.toContain('힌트 켬');
  });

  it('악보 보고 빨리 치기: 힌트 켬 기록만 있으면 그 값에 「힌트 켬」이 붙는다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420) }));
    open();
    const sight = card('악보 보고 빨리 치기');
    expect(sight.querySelector('.mini-card-value')?.textContent).toBe('0.42초힌트 켬');
    expect(sight.querySelector('.mini-card-variant')?.textContent).toBe('힌트 켬');
    // 다른 네 카드는 비어 있다
    expect(emptyCards()).toBe(4);
  });

  it('누구보다 빠르게: 10초·5초 기록이 다 있으면 10초 기록을 갈래 이름 없이 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), 'speed:5s': speedFiveRecord(36) }));
    open();
    const speed = card('누구보다 빠르게');
    expect(speed.querySelector('.mini-card-value')?.textContent).toBe('68타');
    expect(speed.querySelector('.mini-card-variant')).toBeNull();
  });

  it('누구보다 빠르게: 5초 기록만 있으면 그 값에 「5초」가 붙는다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'speed:5s': speedFiveRecord(36) }));
    open();
    const speed = card('누구보다 빠르게');
    expect(speed.querySelector('.mini-card-value')?.textContent).toBe('36타5초');
    expect(speed.querySelector('.mini-card-variant')?.textContent).toBe('5초');
    expect(emptyCards()).toBe(4);
  });

  it('강약중강약의 기록만 있으면 그 카드만 값을 보이고 다른 카드는 「아직 기록이 없어요」', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ dynamics: dynamicsRecord(17) }));
    open();
    expect(card('누구보다 빠르게').textContent).toContain('아직 기록이 없어요');
    expect(card('누구보다 빠르게').querySelector('.mini-card-value')).toBeNull();
    expect(card('강약중강약').querySelector('.mini-card-value')?.textContent).toBe('오차 17');
    expect(card('강약중강약').textContent).not.toContain('아직 기록이 없어요');
    expect(card('악보 보고 빨리 치기').textContent).toContain('아직 기록이 없어요');
  });

  it('카드의 기록은 어느 게임을 골랐는지와 상관없이 같다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), dynamics: dynamicsRecord(17) }));
    open();
    fireEvent.click(card('인간 메트로놈'));
    expect(cardValues()).toEqual(['68타', '오차 17']);
    expect(emptyCards()).toBe(3);
  });

  it('어디까지 올라가는 거예요?: 기록이 있으면 그 카드만 「9번」을 보이고 나머지는 비어 있다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ crescendo: crescendoRecord(9) }));
    open();
    const crescendo = card('어디까지 올라가는 거예요?');
    expect(crescendo.querySelector('.mini-card-value')?.textContent).toBe('9번');
    expect(crescendo.textContent).not.toContain('아직 기록이 없어요');
    expect(emptyCards()).toBe(4);
  });

  it('어디까지 올라가는 거예요?: 고르면 큰 카드에 「최고 기록」 한 줄로 「9번」이 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ crescendo: crescendoRecord(9) }));
    open('/play/mini?game=crescendo');
    expect(heroName()).toBe('어디까지 올라가는 거예요?');
    expect(heroRows()).toEqual([['최고 기록', '9번']]);
  });
});
