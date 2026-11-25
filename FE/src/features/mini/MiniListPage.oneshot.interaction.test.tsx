// @vitest-environment happy-dom
// MiniListPage 검증(이벤트 스위치 켜짐): 「정적 뒤 한 방」 카드가 다섯째로 나타난다.
// 목록은 모듈이 읽힐 때 정해져서 스위치를 파일마다 바꿔 끼운다. 꺼진 쪽은 MiniListPage.interaction.test.tsx가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MINI_PATH } from '@/domain/play/miniGame';
import { serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { MiniListPage } from '@/features/mini/MiniListPage';
import { useAuth } from '@/store/authStore';

vi.mock('@/config/miniOneShot', () => ({ ONE_SHOT_AUDIO_BASE: '/event-audio', ONE_SHOT_ENABLED: true }));

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

function oneShotRecord(errorMs: number): MiniRecord {
  return { gameId: 'oneshot', variant: 'iwaly', score: Math.abs(errorMs), at: '2026-11-24T10:00:00.000Z', detail: { errorMs } };
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

describe('미니게임 목록(이벤트 스위치 켜짐)', () => {
  it('카드가 다섯이고 카탈로그 순서대로이며 다섯째가 「정적 뒤 한 방」(꼬리표 「이벤트」)이다', () => {
    const { container } = open();
    expect(container.querySelectorAll('.mini-card')).toHaveLength(5);
    const names = Array.from(container.querySelectorAll('.mini-card-name')).map((el) => el.textContent);
    expect(names).toEqual(['누구보다 빠르게', '강약중강약', '악보 보고 빨리 치기', '인간 메트로놈', '정적 뒤 한 방']);
    const tags = Array.from(container.querySelectorAll('.mini-card-tag')).map((el) => el.textContent);
    expect(tags).toEqual(['10초', '3타', '10문제', '16타', '이벤트']);
    expect(screen.getByText('노래가 멈춘 뒤 정확한 박에 한 방')).toBeTruthy();
  });

  it('저장된 기록이 없으면 다섯 카드 모두 「아직 기록이 없어요」', () => {
    const { container } = open();
    expect(screen.getAllByText('아직 기록이 없어요')).toHaveLength(5);
    expect(container.querySelector('.mini-card-value')).toBeNull();
  });

  it('「정적 뒤 한 방」 기록이 있으면 그 카드가 오차 값 38ms를 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'oneshot:iwaly': oneShotRecord(38) }));
    const { container } = open();
    const cards = Array.from(container.querySelectorAll('.mini-card'));
    expect(cards[4].querySelector('.mini-card-value')?.textContent).toBe('38ms');
    expect(cards[4].textContent).not.toContain('아직 기록이 없어요');
    // 곡이 하나뿐이라 값 뒤에 곡 이름이 붙지 않는다
    expect(cards[4].querySelector('.mini-card-variant')).toBeNull();
    for (const card of cards.slice(0, 4)) expect(card.textContent).toContain('아직 기록이 없어요');
  });

  it('[정적 뒤 한 방 시작]을 누르면 /play/mini/oneshot으로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '정적 뒤 한 방 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/oneshot');
  });

  it('다른 카드의 [시작]은 그대로 자기 경로로 간다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '인간 메트로놈 시작' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/mini/tempo');
  });
});
