// @vitest-environment happy-dom
// MiniListPage 검증: /play/mini의 카드 하나, 최고 기록 유무에 따른 문구, 저장소 읽기, [시작] 이동.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MINI_PATH } from '@/domain/play/miniGame';
import { serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { MiniListPage } from '@/features/mini/MiniListPage';
import { useAuth } from '@/store/authStore';

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
  it('카드가 하나이고 이름·규칙·꼬리표가 보인다', () => {
    const { container } = open();
    expect(container.querySelectorAll('.mini-card')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '누구보다 빠르게' })).toBeTruthy();
    expect(screen.getByText('10초 동안 스네어 가장 많이 치기')).toBeTruthy();
    expect(screen.getByText('10초')).toBeTruthy();
  });

  it('저장된 최고 기록이 없으면 「아직 기록이 없어요」', () => {
    const { container } = open();
    expect(screen.getByText('아직 기록이 없어요')).toBeTruthy();
    expect(container.querySelector('.mini-card-value')).toBeNull();
  });

  it('저장된 최고 기록이 있으면 값과 단위가 보인다(열릴 때 저장소에서 다시 읽는다)', () => {
    // 스토어는 이미 만들어져 비어 있다. 저장소에만 값을 넣어 두면 화면이 열릴 때 reload가 읽어 와야 보인다
    localStorage.setItem(STORAGE_KEY, serializeRecords({ speed: speedRecord(68) }));
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    const { container } = open();
    expect(container.querySelector('.mini-card-value')?.textContent).toBe('68타');
    expect(screen.queryByText('아직 기록이 없어요')).toBeNull();
    expect(useMiniRecords.getState().best('speed')?.score).toBe(68);
  });

  it('열려 있는 동안 스토어의 기록이 바뀌면 카드가 따라간다', () => {
    const { container } = open();
    expect(screen.getByText('아직 기록이 없어요')).toBeTruthy();
    act(() => {
      useMiniRecords.getState().submit(speedRecord(41));
    });
    expect(container.querySelector('.mini-card-value')?.textContent).toBe('41타');
  });

  it('[시작]을 누르면 /play/mini/speed로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '누구보다 빠르게 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/speed');
  });
});
