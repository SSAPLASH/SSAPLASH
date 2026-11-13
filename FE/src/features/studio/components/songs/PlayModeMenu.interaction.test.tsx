// @vitest-environment happy-dom
// [▶ 플레이] 모드 선택 메뉴 (설계 CHART-003 4-2·6절): 열림·항목 주소·키보드·Esc·aria.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { PlayModeMenu } from './PlayModeMenu';

afterEach(cleanup);

const song: SongSummary = {
  id: 7,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'AUDIO',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: true,
  accompanimentStatus: 'READY',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
  sheetId: null,
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function setup(onOpenChange?: (open: boolean) => void) {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <PlayModeMenu song={song} onOpenChange={onOpenChange} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('button', { name: '「별빛 산책」 플레이' });
}

describe('PlayModeMenu', () => {
  it('트리거는 보이는 글자 「플레이」와 aria-haspopup·aria-expanded를 가진다', async () => {
    const trigger = setup();
    expect(trigger.textContent).toBe('플레이');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await userEvent.setup().click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('두 항목의 이름·설명·주소(start 없음)', async () => {
    const user = userEvent.setup();
    await user.click(setup());
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('리듬 게임');
    expect(items[0].textContent).toContain('떨어지는 노트에 맞춰 점수 도전');
    expect(items[0].getAttribute('href')).toBe('/play?scope=MINE&song=7');
    expect(items[1].textContent).toContain('악보 연습');
    expect(items[1].textContent).toContain('악보를 보며 내 속도로 연습');
    expect(items[1].getAttribute('href')).toBe('/sheet?scope=MINE&song=7');
    for (const a of items) expect(a.getAttribute('href')).not.toContain('start');
  });

  it('항목을 누르면 그 주소로 이동하고 메뉴가 닫힌다', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await user.click(setup(onOpenChange));
    await user.click(screen.getByRole('menuitem', { name: /악보 연습/ }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?scope=MINE&song=7');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('열리면 첫 항목에 초점, ↓/↑로 순환 이동', async () => {
    const user = userEvent.setup();
    await user.click(setup());
    const [game, sheet] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(game);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(sheet);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(game);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(sheet);
  });

  it('Enter로 첫 항목을 고르면 리듬 게임 주소로 간다', async () => {
    const user = userEvent.setup();
    await user.click(setup());
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('where').textContent).toBe('/play?scope=MINE&song=7');
  });

  it('Esc는 닫고 초점을 [플레이]로 돌리며 aria-expanded가 false가 된다', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const trigger = setup(onOpenChange);
    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
