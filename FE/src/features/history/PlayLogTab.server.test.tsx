// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllPlays, type PlaySummary } from '@/api/plays';
import { setPlayLogOwner } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';
import { queryClient } from '@/runtime/queryClient';
import { PlayLogTab } from './PlayLogTab';

vi.mock('@/api/plays', () => ({ listAllPlays: vi.fn() }));
vi.mock('@/components/song/useDeletedSongIds', () => ({ useDeletedSongIds: () => new Set() }));

const summary = (over: Partial<PlaySummary> = {}): PlaySummary => ({
  playId: 'remote', startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T00:01:00Z',
  mode: 'RHYTHM', inputSource: 'STICK', songId: 1, songTitle: '서버 곡', chartVersionId: 2,
  chartId: 3, difficulty: 'EASY', endReason: 'COMPLETED', songAccessible: true,
  score: 92400, accuracy: 96.8, maxCombo: 10, hasReport: true, ...over,
});

const login = (id: number) => {
  setPlayLogOwner(id);
  useAuth.setState({ status: 'authenticated', user: { id } as NonNullable<ReturnType<typeof useAuth.getState>['user']> });
};
const show = () => render(<MemoryRouter><PlayLogTab /></MemoryRouter>);

// 서버 기록은 앱 전역 캐시다. 테스트마다 비운다
beforeEach(() => { queryClient.clear(); localStorage.clear(); vi.mocked(listAllPlays).mockReset(); login(1); });
afterEach(() => { cleanup(); localStorage.clear(); setPlayLogOwner(null); useAuth.setState({ status: 'unknown', user: null }); });

describe('서버 연주 기록', () => {
  it('로컬 기록 없이 다른 기기의 기록과 리포트를 표시하고 접근 불가 곡을 안전하게 표시한다', async () => {
    vi.mocked(listAllPlays).mockResolvedValue([summary(), summary({ playId: 'deleted', songTitle: null, songAccessible: false, hasReport: true, score: null, accuracy: null })]);
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '리포트 보기' }).map((a) => a.getAttribute('href'))).toEqual(['/result/remote/report', '/result/deleted/report']);
    expect(screen.getAllByText('이용할 수 없는 곡').length).toBeGreaterThan(0);
    expect(screen.getByText('96.8% / 92,400')).toBeTruthy();
    expect(screen.getByText('— / —')).toBeTruthy();
  });

  it('빈 서버 결과는 빈 상태를, 오류는 재시도를 표시한다', async () => {
    vi.mocked(listAllPlays).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('서버 기록을 불러오지 못했어요');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('아직 연주 기록이 없어요')).toBeTruthy();
  });

  it('서버와 같은 로컬 기록은 중복하지 않고, 로컬 전용 기록은 결과 화면으로 연다', async () => {
    const local = (playId: string) => ({ playId, title: `로컬 ${playId}`, mode: 'RHYTHM', startedAt: '2026-11-01T00:00:00Z', songNumericId: null, notes: [], hits: [], summary: { score: 100, accuracy: 0.5 } });
    localStorage.setItem('ssaplash.playlogs.u1', JSON.stringify([local('remote'), local('only-local')]));
    vi.mocked(listAllPlays).mockResolvedValue([summary()]);
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    expect(screen.queryByText('로컬 remote')).toBeNull();
    expect(screen.getByText('로컬 only-local')).toBeTruthy();
    expect(screen.getByRole('link', { name: '결과 보기' }).getAttribute('href')).toBe('/result/only-local');
  });

  it('리포트가 없는 서버 전용 기록은 링크를 만들지 않는다', async () => {
    vi.mocked(listAllPlays).mockResolvedValue([summary({ hasReport: false })]);
    show();
    expect(await screen.findByText('리포트 없음')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '리포트 보기' })).toBeNull();
    expect(screen.queryByRole('link', { name: '결과 보기' })).toBeNull();
  });

  it('계정 변경 뒤 늦게 도착한 이전 계정 응답을 표시하지 않는다', async () => {
    let resolveFirst!: (plays: PlaySummary[]) => void;
    vi.mocked(listAllPlays).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([summary({ playId: 'second', songTitle: '두 번째 계정' })]);
    show();
    act(() => login(2));
    expect(await screen.findByText('두 번째 계정')).toBeTruthy();
    await act(async () => resolveFirst([summary({ songTitle: '이전 계정' })]));
    await waitFor(() => expect(screen.queryByText('이전 계정')).toBeNull());
  });
});

describe('서버 연주 기록 캐시 (설계 TECH-351)', () => {
  it('다시 들어오면 30초 안에는 요청하지 않고, 다른 계정이면 그 계정 기록을 새로 읽는다', async () => {
    vi.mocked(listAllPlays).mockResolvedValue([summary()]);
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    cleanup();
    show();
    expect(screen.getByText('서버 곡')).toBeTruthy();
    expect(listAllPlays).toHaveBeenCalledTimes(1);
    cleanup();
    vi.mocked(listAllPlays).mockResolvedValue([summary({ playId: 'b', songTitle: '다른 계정 곡' })]);
    login(2);
    show();
    expect(await screen.findByText('다른 계정 곡')).toBeTruthy();
    expect(screen.queryByText('서버 곡')).toBeNull();
  });
});
