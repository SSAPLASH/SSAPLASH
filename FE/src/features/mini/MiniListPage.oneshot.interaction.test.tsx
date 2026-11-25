// @vitest-environment happy-dom
// MiniListPage 검증(이벤트 스위치 켜짐): 「정적 뒤 한 방」 카드가 여섯째로 나타나고, 고르면 큰 카드에 곡별 기록 줄이 보인다.
// 목록은 모듈이 읽힐 때 정해져서 스위치를 파일마다 바꿔 끼운다. 꺼진 쪽은 MiniListPage.interaction.test.tsx가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MINI_PATH } from '@/domain/play/miniGame';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { MiniListPage } from '@/features/mini/MiniListPage';
import { useAuth } from '@/store/authStore';

vi.mock('@/config/miniOneShot', () => ({ ONE_SHOT_AUDIO_BASE: '/event-audio', ONE_SHOT_ENABLED: true }));

const STORAGE_KEY = 'ssaplash.mini.v1';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function open(path: string = MINI_PATH) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

function grid(): HTMLElement {
  return screen.getByRole('list', { name: '게임 고르기' });
}

function cards(): HTMLElement[] {
  return within(grid()).getAllByRole('button');
}

function card(name: string): HTMLElement {
  const found = cards().find((el) => el.querySelector('.mini-card-name')?.textContent === name);
  if (!found) throw new Error(`카드가 없다: ${name}`);
  return found;
}

function hero(): HTMLElement {
  return document.querySelector('.mini-hero') as HTMLElement;
}

function heroRows(): [string | null, string | null][] {
  return Array.from(hero().querySelectorAll('.mini-hero-row')).map((row) => [
    row.querySelector('dt')?.textContent ?? null,
    row.querySelector('dd')?.textContent ?? null,
  ]);
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
  it('카드가 여섯이고 카탈로그 순서대로이며 여섯째가 「정적 뒤 한 방」(꼬리표 「이벤트」)이다', () => {
    open();
    expect(cards()).toHaveLength(6);
    const names = cards().map((el) => el.querySelector('.mini-card-name')?.textContent);
    expect(names).toEqual(['누구보다 빠르게', '강약중강약', '악보 보고 빨리 치기', '인간 메트로놈', '어디까지 올라가는 거예요?', '정적 뒤 한 방']);
    const tags = cards().map((el) => el.querySelector('.mini-card-tag')?.textContent);
    expect(tags).toEqual(['10초', '3타', '10문제', '16타', '약하면 끝', '이벤트']);
    expect(within(grid()).getByText('노래가 멈춘 뒤 정확한 박에 한 방')).toBeTruthy();
    expect(cards()[5].getAttribute('data-game')).toBe('oneshot');
  });

  it('주소 값이 없으면 이벤트 빌드에서도 목록 첫 게임이 고른 상태다', () => {
    open();
    expect(within(hero()).getByRole('heading', { level: 3 }).textContent).toBe('누구보다 빠르게');
    expect(card('누구보다 빠르게').getAttribute('aria-pressed')).toBe('true');
    expect(card('정적 뒤 한 방').getAttribute('aria-pressed')).toBe('false');
  });

  it('저장된 기록이 없으면 여섯 카드 모두 「아직 기록이 없어요」', () => {
    open();
    expect(within(grid()).getAllByText('아직 기록이 없어요')).toHaveLength(6);
    expect(grid().querySelector('.mini-card-value')).toBeNull();
  });

  it('「정적 뒤 한 방」 기록이 있으면 그 카드가 오차 값 38ms를 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'oneshot:iwaly': oneShotRecord(38) }));
    open();
    const shot = card('정적 뒤 한 방');
    expect(shot.querySelector('.mini-card-value')?.textContent).toBe('38ms');
    expect(shot.textContent).not.toContain('아직 기록이 없어요');
    // 곡이 하나뿐이라 값 뒤에 곡 이름이 붙지 않는다
    expect(shot.querySelector('.mini-card-variant')).toBeNull();
    for (const el of cards().slice(0, 5)) expect(el.textContent).toContain('아직 기록이 없어요');
  });

  it('「정적 뒤 한 방」 카드를 누르면 큰 카드가 그 게임으로 바뀌고 주소에 남는다', () => {
    open();
    fireEvent.click(card('정적 뒤 한 방'));
    expect(hero().getAttribute('data-game')).toBe('oneshot');
    expect(within(hero()).getByRole('heading', { level: 3 }).textContent).toBe('정적 뒤 한 방');
    expect(hero().querySelector('.mini-hero-tag')?.textContent).toBe('이벤트');
    expect(hero().querySelector('.mini-hero-desc')?.textContent).toBe(miniGameInfo('oneshot').description);
    expect(where()).toBe('/play/mini?game=oneshot');
  });

  it('주소 값 game=oneshot으로 열면 「정적 뒤 한 방」이 고른 상태다(이벤트 부스용 주소)', () => {
    open('/play/mini?game=oneshot');
    expect(hero().getAttribute('data-game')).toBe('oneshot');
    expect(card('정적 뒤 한 방').getAttribute('aria-pressed')).toBe('true');
    expect(card('누구보다 빠르게').getAttribute('aria-pressed')).toBe('false');
  });

  it('큰 카드의 기록 줄은 곡마다 한 줄이고 이름은 곡 이름이다', () => {
    open('/play/mini?game=oneshot');
    expect(heroRows()).toEqual([['I Will Always Love You', '아직 기록이 없어요']]);
  });

  it('곡 기록이 있으면 그 곡 줄에 오차 값이 보인다', () => {
    localStorage.setItem(STORAGE_KEY, serializeRecords({ 'oneshot:iwaly': oneShotRecord(-38) }));
    open('/play/mini?game=oneshot');
    expect(heroRows()).toEqual([['I Will Always Love You', '38ms']]);
  });

  it('「정적 뒤 한 방」을 고른 뒤 [시작]을 누르면 /play/mini/oneshot으로 간다', () => {
    open();
    fireEvent.click(card('정적 뒤 한 방'));
    fireEvent.click(screen.getByRole('button', { name: '정적 뒤 한 방 시작' }));
    expect(where()).toBe('/play/mini/oneshot');
  });

  it('「정적 뒤 한 방」 카드를 두 번 누르면 바로 시작한다', () => {
    open();
    fireEvent.doubleClick(card('정적 뒤 한 방'));
    expect(where()).toBe('/play/mini/oneshot');
  });

  it('다른 게임의 시작은 그대로 자기 경로로 간다', () => {
    open();
    fireEvent.click(card('인간 메트로놈'));
    fireEvent.click(screen.getByRole('button', { name: '인간 메트로놈 시작' }));
    expect(where()).toBe('/play/mini/tempo');
  });
});
