// @vitest-environment happy-dom
// MiniListPage 검증: /play/mini의 카드 다섯(카탈로그 순서), 최고 기록 유무에 따른 문구, 저장소 읽기, [시작] 이동.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MINI_PATH } from '@/domain/play/miniGame';
import { serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { MiniListPage } from '@/features/mini/MiniListPage';
import { useAuth } from '@/store/authStore';

// 「정적 뒤 한 방」 이벤트 스위치가 꺼진 빌드. 켜진 쪽은 MiniListPage.oneshot.interaction.test.tsx가 본다
vi.mock('@/config/miniOneShot', () => ({ ONE_SHOT_AUDIO_BASE: null, ONE_SHOT_ENABLED: false }));

const STORAGE_KEY = 'ssaplash.mini.v1';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function open() {
  return render(
    <MemoryRouter initialEntries={[MINI_PATH]}>
      <Routes>
        <Route path="/play/mini" element={<MiniListPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function speedRecord(score: number): MiniRecord {
  return { gameId: 'speed', score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
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

describe('미니게임 목록', () => {
  it('카드가 다섯이고 카탈로그 순서대로 이름·규칙·꼬리표가 보인다', () => {
    const { container } = open();
    expect(container.querySelectorAll('.mini-card')).toHaveLength(5);
    const names = Array.from(container.querySelectorAll('.mini-card-name')).map((el) => el.textContent);
    expect(names).toEqual(['누구보다 빠르게', '강약중강약', '악보 보고 빨리 치기', '인간 메트로놈', '어디까지 올라가는 거예요?']);
    expect(screen.getByRole('heading', { name: '인간 메트로놈' })).toBeTruthy();
    expect(screen.getByText('소리가 꺼져도 같은 빠르기로 치기')).toBeTruthy();
    expect(screen.getByText('16타')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '어디까지 올라가는 거예요?' })).toBeTruthy();
    expect(screen.getByText('앞 타격보다 조금씩 더 세게 치기')).toBeTruthy();
    expect(screen.getByText('약하면 끝')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '누구보다 빠르게' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '강약중강약' })).toBeTruthy();
    expect(screen.getByText('10초 동안 스네어 가장 많이 치기')).toBeTruthy();
    expect(screen.getByText('내 세기를 재고 숫자에 맞춰 세 번 치기')).toBeTruthy();
    expect(screen.getByText('10초')).toBeTruthy();
    expect(screen.getByText('3타')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '악보 보고 빨리 치기' })).toBeTruthy();
    expect(screen.getByText('음표가 뜨면 맞는 패드를 바로 치기')).toBeTruthy();
    expect(screen.getByText('10문제')).toBeTruthy();
    const tags = Array.from(container.querySelectorAll('.mini-card-tag')).map((el) => el.textContent);
    expect(tags).toEqual(['10초', '3타', '10문제', '16타', '약하면 끝']);
  });

  it('저장된 최고 기록이 없으면 다섯 카드 모두 「아직 기록이 없어요」', () => {
    const { container } = open();
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(5);
    expect(container.querySelector('.mini-card-value')).toBeNull();
  });

  it('저장된 최고 기록이 있으면 값과 단위가 보인다(열릴 때 저장소에서 다시 읽는다)', () => {
    // 스토어는 이미 만들어져 비어 있다. 저장소에만 값을 넣어 두면 화면이 열릴 때 reload가 읽어 와야 보인다
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68) }));
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    const { container } = open();
    expect(container.querySelector('.mini-card-value')?.textContent).toBe('68타');
    // 속도 카드는 값이 보이고, 나머지 네 카드는 비어 있다
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(4);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(68);
  });

  it('열려 있는 동안 스토어의 기록이 바뀌면 카드가 따라간다', () => {
    const { container } = open();
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(5);
    act(() => {
      useMiniRecords.getState().submit(speedRecord(41));
    });
    expect(container.querySelector('.mini-card-value')?.textContent).toBe('41타');
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(4);
  });

  it('두 게임의 기록이 있으면 카드마다 자기 최고 기록을 보인다(68타·오차 17)', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68), dynamics: dynamicsRecord(17) }));
    const { container } = open();
    const values = Array.from(container.querySelectorAll('.mini-card-value')).map((el) => el.textContent);
    expect(values).toEqual(['68타', '오차 17']);
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(3);
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
    const { container } = open();
    const values = Array.from(container.querySelectorAll('.mini-card-value')).map((el) => el.textContent);
    expect(values).toEqual(['68타', '오차 17', '0.61초', '14ms', '9번']);
    expect(screen.queryByText('아직 기록이 없어요')).toBeNull();
  });

  it('인간 메트로놈: 기록이 있으면 그 카드만 ms 값을 보이고 나머지는 비어 있다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ tempo: tempoRecord(14) }));
    const { container } = open();
    const cards = Array.from(container.querySelectorAll('.mini-card'));
    expect(cards[3].querySelector('.mini-card-value')?.textContent).toBe('14ms');
    expect(cards[3].textContent).not.toContain('아직 기록이 없어요');
    for (const card of cards.slice(0, 3)) expect(card.textContent).toContain('아직 기록이 없어요');
  });

  it('인간 메트로놈: 기록이 없으면 「아직 기록이 없어요」', () => {
    const { container } = open();
    const card = container.querySelectorAll('.mini-card')[3];
    expect(card.textContent).toContain('아직 기록이 없어요');
    expect(card.querySelector('.mini-card-value')).toBeNull();
  });

  it('악보 보고 빨리 치기: 두 갈래가 있으면 힌트 끔 기록을 갈래 이름 없이 보인다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420), 'sight:hint-off': sightRecord('hint-off', 610) }),
    );
    const { container } = open();
    const card = container.querySelectorAll('.mini-card')[2];
    expect(card.querySelector('.mini-card-value')?.textContent).toBe('0.61초');
    expect(card.querySelector('.mini-card-variant')).toBeNull();
    expect(card.textContent).not.toContain('힌트 켬');
  });

  it('악보 보고 빨리 치기: 힌트 켬 기록만 있으면 그 값에 「힌트 켬」이 붙는다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'sight:hint-on': sightRecord('hint-on', 420) }));
    const { container } = open();
    const card = container.querySelectorAll('.mini-card')[2];
    expect(card.querySelector('.mini-card-value')?.textContent).toBe('0.42초힌트 켬');
    expect(card.querySelector('.mini-card-variant')?.textContent).toBe('힌트 켬');
    // 다른 네 카드는 비어 있다
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(4);
  });

  it('악보 보고 빨리 치기: 기록이 없으면 「아직 기록이 없어요」', () => {
    const { container } = open();
    const card = container.querySelectorAll('.mini-card')[2];
    expect(card.textContent).toContain('아직 기록이 없어요');
    expect(card.querySelector('.mini-card-value')).toBeNull();
  });

  it('강약중강약의 기록만 있으면 그 카드만 값을 보이고 다른 카드는 「아직 기록이 없어요」', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ dynamics: dynamicsRecord(17) }));
    const { container } = open();
    const cards = Array.from(container.querySelectorAll('.mini-card'));
    expect(cards[0].textContent).toContain('아직 기록이 없어요');
    expect(cards[0].querySelector('.mini-card-value')).toBeNull();
    expect(cards[1].querySelector('.mini-card-value')?.textContent).toBe('오차 17');
    expect(cards[1].textContent).not.toContain('아직 기록이 없어요');
    expect(cards[2].textContent).toContain('아직 기록이 없어요');
  });

  it('누구보다 빠르게의 기록만 있으면 그 카드만 값을 보이고 강약중강약은 「아직 기록이 없어요」', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68) }));
    const { container } = open();
    const cards = Array.from(container.querySelectorAll('.mini-card'));
    expect(cards[0].querySelector('.mini-card-value')?.textContent).toBe('68타');
    expect(cards[1].textContent).toContain('아직 기록이 없어요');
    expect(cards[1].querySelector('.mini-card-value')).toBeNull();
    expect(cards[2].textContent).toContain('아직 기록이 없어요');
  });

  it('이벤트 스위치가 꺼져 있으면 「정적 뒤 한 방」 카드와 [정적 뒤 한 방 시작]이 없다', () => {
    const { container } = open();
    expect(container.querySelectorAll('.mini-card')).toHaveLength(5);
    expect(screen.queryByRole('heading', { name: '정적 뒤 한 방' })).toBeNull();
    expect(screen.queryByRole('button', { name: '정적 뒤 한 방 시작' })).toBeNull();
    expect(screen.queryByText('이벤트')).toBeNull();
  });

  it('[시작]을 누르면 /play/mini/speed로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '누구보다 빠르게 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/speed');
  });

  it('[강약중강약 시작]을 누르면 /play/mini/dynamics로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '강약중강약 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/dynamics');
  });

  it('[악보 보고 빨리 치기 시작]을 누르면 /play/mini/sight로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '악보 보고 빨리 치기 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/sight');
  });

  it('[인간 메트로놈 시작]을 누르면 /play/mini/tempo로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '인간 메트로놈 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/tempo');
  });

  it('어디까지 올라가는 거예요?: 기록이 있으면 그 카드만 「9번」을 보이고 나머지는 비어 있다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ crescendo: crescendoRecord(9) }));
    const { container } = open();
    const cards = Array.from(container.querySelectorAll('.mini-card'));
    expect(cards[4].querySelector('.mini-card-value')?.textContent).toBe('9번');
    expect(cards[4].textContent).not.toContain('아직 기록이 없어요');
    for (const card of cards.slice(0, 4)) expect(card.textContent).toContain('아직 기록이 없어요');
  });

  it('[어디까지 올라가는 거예요? 시작]을 누르면 /play/mini/crescendo로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '어디까지 올라가는 거예요? 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/crescendo');
  });
});
