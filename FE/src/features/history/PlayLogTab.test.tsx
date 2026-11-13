// @vitest-environment happy-dom
// 플레이 기록 탭 — 로그인 없는 빌드(이 브라우저의 기록만). 서버 연동은 PlayLogTab.server.test
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPlays } from '@/api/play/plays';
import { setPlayLogOwner } from '@/engine/playLog';
import { queryClient } from '@/runtime/queryClient';
import { useAuth } from '@/store/authStore';
import { PlayLogTab } from './PlayLogTab';

vi.mock('@/api/play/plays', () => ({ listPlays: vi.fn() }));
vi.mock('@/components/song/useDeletedSongIds', () => ({ useDeletedSongIds: () => new Set() }));

const saved = (id: string, title: string, day: number, hour: number, over: object = {}) => ({
  playId: id, title, mode: 'RHYTHM', difficulty: 'NORMAL', startedAt: new Date(2026, 10, day, hour, 0).toISOString(), durationMs: 60000,
  songNumericId: null, notes: [], hits: [], summary: { score: 1000, accuracy: 0.5, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 }, ...over,
});
const store = (logs: unknown[]) => localStorage.setItem('ssaplash.playlogs', JSON.stringify(logs));
const show = () => render(<MemoryRouter><PlayLogTab /></MemoryRouter>);
const titles = () => [...document.querySelectorAll('.history-row-title')].map((n) => n.textContent);
/** 건수 줄(굵은 숫자 + 글자) */
const count = () => document.querySelector('.history-count')?.textContent;

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  setPlayLogOwner(null);
  vi.mocked(listPlays).mockReset();
  useAuth.setState({ status: 'anonymous', user: null });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  useAuth.setState({ status: 'unknown', user: null });
});

describe('PlayLogTab (이 브라우저의 기록만)', () => {
  it('최신순으로 날짜별로 묶고, 서버를 부르지 않으며 저장 상태를 보이지 않는다', () => {
    store([saved('a', '오래된곡', 3, 9), saved('b', '최근곡', 5, 21), saved('c', '같은날곡', 5, 10)]);
    show();
    expect(titles()).toEqual(['최근곡', '같은날곡', '오래된곡']);
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain('11월 5일');
    expect(within(screen.getByRole('region', { name: groups[0]! })).getByText('2판')).toBeTruthy();
    expect(count()).toBe('3개 기록');
    expect(screen.queryByText('저장 안 됨')).toBeNull();
    expect(screen.getAllByRole('link', { name: /결과 보기$/ })).toHaveLength(3);
    expect(listPlays).not.toHaveBeenCalled();
  });

  it('기록이 0건이면 빈 상태와 [리듬 게임 시작]만 그리고 도구 줄은 없다', () => {
    show();
    expect(screen.getByText('아직 연주 기록이 없어요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '리듬 게임 시작' }).getAttribute('href')).toBe('/play');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(count()).toBeUndefined();
  });

  it('도구 줄: 검색칸, 모드·기간·정렬 단추', () => {
    store([saved('a', 'Alpha', 5, 9)]);
    show();
    const search = screen.getByRole('searchbox', { name: '곡 제목 검색' });
    // 서버가 100자를 넘는 검색어를 400으로 거부하므로 입력에서 막는다
    expect(search.getAttribute('maxlength')).toBe('100');
    expect(within(screen.getByRole('radiogroup', { name: '모드 필터' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['전체', '리듬 게임', '악보 연습']);
    expect(within(screen.getByRole('radiogroup', { name: '기간' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['전체 기간', '7일', '30일']);
    expect(within(screen.getByRole('radiogroup', { name: '정렬' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['최신', '오래된']);
  });

  it('검색어(대소문자 무시)로 줄고 건수도 따라간다', async () => {
    store([saved('a', 'Alpha', 5, 9), saved('b', 'Beta', 5, 10), saved('c', 'alphabet', 5, 11)]);
    show();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' ALPHA ' } });
    await waitFor(() => expect(titles()).toEqual(['alphabet', 'Alpha']));
    expect(count()).toBe('2개 기록');
  });

  it('모드 단추와 정렬 단추가 바로 적용된다', () => {
    store([saved('a', '게임곡', 5, 9), saved('b', '악보곡', 5, 10, { mode: 'SHEET' }), saved('c', '옛게임곡', 3, 9)]);
    show();
    fireEvent.click(screen.getByRole('radio', { name: '악보 연습' }));
    expect(titles()).toEqual(['악보곡']);
    fireEvent.click(screen.getByRole('radio', { name: '전체' }));
    fireEvent.click(screen.getByRole('radio', { name: '오래된' }));
    expect(titles()).toEqual(['옛게임곡', '게임곡', '악보곡']);
  });

  it('화면을 켜 둔 채 자정을 넘겨도 조건을 바꾸면 오늘·어제가 새 날짜 기준으로 바뀐다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 10, 5, 23, 0));
      store([saved('a', 'Alpha', 5, 21)]);
      show();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('오늘');
      vi.setSystemTime(new Date(2026, 10, 6, 1, 0));
      fireEvent.click(screen.getByRole('radio', { name: '오래된' }));
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('어제');
    } finally {
      vi.useRealTimers();
    }
  });

  it('조건에 맞는 기록이 없으면 안내와 [조건 지우기], 누르면 전체로 돌아온다', async () => {
    store([saved('a', 'Alpha', 5, 9)]);
    show();
    fireEvent.click(screen.getByRole('radio', { name: '악보 연습' }));
    expect(screen.getByText('조건에 맞는 기록이 없어요')).toBeTruthy();
    expect(count()).toBe('0개 기록');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '조건 지우기' }));
    await waitFor(() => expect(titles()).toEqual(['Alpha']));
  });
});
