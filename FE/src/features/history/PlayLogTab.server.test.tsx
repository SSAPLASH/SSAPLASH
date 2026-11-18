// @vitest-environment happy-dom
// 플레이 기록 탭 — 서버 검색·더 보기와 아직 서버에 없는 기록의 저장 상태 (설계 COACH-연주-기록-화면-개편 4)
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPlays, type PlaySummary } from '@/api/play/plays';
import type { PageResponse } from '@/api/play/recordings';
import type { PlayUploadState } from '@/domain/play/playLog';
import { setPlayLogOwner } from '@/engine/playLog';
import { queryClient } from '@/runtime/queryClient';
import { startPlaySync, usePlaySync } from '@/runtime/playSync';
import { useAuth } from '@/store/authStore';
import { PlayLogTab } from './PlayLogTab';

vi.mock('@/api/play/plays', () => ({ listPlays: vi.fn() }));
vi.mock('@/components/song/useDeletedSongIds', () => ({ useDeletedSongIds: () => new Set() }));
vi.mock('@/runtime/playSync', async () => {
  const { create } = await import('zustand');
  return { usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn(() => Promise.resolve(null)) };
});

const summary = (over: Partial<PlaySummary> = {}): PlaySummary => ({
  playId: 'remote', startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T00:01:00Z',
  mode: 'RHYTHM', inputSource: 'STICK', songId: 1, songTitle: '서버 곡', chartVersionId: 2,
  chartId: 3, difficulty: 'EASY', endReason: 'COMPLETED', songAccessible: true,
  score: 92400, accuracy: 96.8, maxCombo: 10, hasReport: true, ...over,
});
const page = (items: PlaySummary[], over: Partial<PageResponse<PlaySummary>> = {}): PageResponse<PlaySummary> => ({
  items, page: 0, size: 20, totalElements: items.length, totalPages: 1, hasNext: false, ...over,
});
const up = (status: PlayUploadState['status'], retryable = false): PlayUploadState => ({ status, reason: null, retryable, attempts: 1, updatedAt: '' });
const local = (playId: string, over: object = {}) => ({
  playId, title: `로컬 ${playId}`, mode: 'RHYTHM', difficulty: 'NORMAL', startedAt: '2026-11-01T00:00:30Z', durationMs: 1000,
  songNumericId: null, notes: [], hits: [], summary: { score: 100, accuracy: 0.5 }, ...over,
});
const storeLogs = (logs: unknown[], userId = 1) => localStorage.setItem(`ssaplash.playlogs.u${userId}`, JSON.stringify(logs));

const login = (id: number) => {
  setPlayLogOwner(id);
  useAuth.setState({ status: 'authenticated', user: { id } as NonNullable<ReturnType<typeof useAuth.getState>['user']> });
};
const show = () => render(<MemoryRouter><PlayLogTab /></MemoryRouter>);
const titles = () => [...document.querySelectorAll('.history-row-title')].map((n) => n.textContent);
/** 건수 줄(굵은 숫자 + 글자) */
const count = () => document.querySelector('.history-count')?.textContent;

// 서버 기록은 앱 전역 캐시다. 테스트마다 비운다
beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.mocked(listPlays).mockReset();
  vi.mocked(startPlaySync).mockClear();
  usePlaySync.setState({ states: {} });
  login(1);
});
afterEach(() => { cleanup(); localStorage.clear(); setPlayLogOwner(null); useAuth.setState({ status: 'unknown', user: null }); });

describe('서버 연주 기록', () => {
  it('다른 기기의 기록과 리포트 링크를 보이고, 접근할 수 없는 곡을 안전하게 표시한다', async () => {
    vi.mocked(listPlays).mockResolvedValue(page([summary(), summary({ playId: 'gone', songTitle: null, songAccessible: false, score: null, accuracy: null })]));
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /리포트 보기$/ }).map((a) => a.getAttribute('href'))).toEqual(['/result/remote/report', '/result/gone/report']);
    expect(screen.getByText('이용할 수 없는 곡')).toBeTruthy();
    expect(screen.getByLabelText('정확도 96.8%, 점수 92,400')).toBeTruthy();
    expect(screen.getByLabelText('정확도 없음')).toBeTruthy();
    expect(count()).toBe('2개 기록');
  });

  it('처음 조건은 전체·최신순 첫 쪽(20개)이다', async () => {
    vi.mocked(listPlays).mockResolvedValue(page([summary()]));
    show();
    await screen.findByText('서버 곡');
    expect(vi.mocked(listPlays).mock.calls[0][0]).toEqual({ q: undefined, from: undefined, to: undefined, mode: undefined, sort: 'NEWEST', page: 0, size: 20 });
  });

  it('모드·기간·정렬·검색은 서버가 처리한다', async () => {
    vi.mocked(listPlays).mockResolvedValue(page([summary()]));
    show();
    await screen.findByText('서버 곡');
    fireEvent.click(screen.getByRole('radio', { name: '악보 연습' }));
    fireEvent.click(screen.getByRole('radio', { name: '7일' }));
    fireEvent.click(screen.getByRole('radio', { name: '오래된' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '별빛' } });
    await waitFor(() => expect(vi.mocked(listPlays).mock.calls.at(-1)?.[0]).toMatchObject({ q: '별빛', mode: 'SHEET', sort: 'OLDEST', page: 0 }));
    const sent = vi.mocked(listPlays).mock.calls.at(-1)?.[0];
    expect(sent?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('[더 보기]로 다음 쪽을 이어 받고, 건수는 서버 전체 건수다', async () => {
    vi.mocked(listPlays).mockImplementation(async (p) =>
      p?.page === 0
        ? page([summary({ playId: 'a', songTitle: '첫 곡' })], { totalElements: 2, totalPages: 2, hasNext: true })
        : page([summary({ playId: 'b', songTitle: '둘째 곡', endedAt: '2026-10-30T00:01:00Z' })], { page: 1, totalElements: 2, totalPages: 2 }),
    );
    show();
    await screen.findByText('첫 곡');
    expect(count()).toBe('2개 기록');
    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    expect(await screen.findByText('둘째 곡')).toBeTruthy();
    expect(titles()).toEqual(['첫 곡', '둘째 곡']);
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull();
  });

  it('빈 서버 결과는 빈 상태를, 오류는 다시 시도를 보인다', async () => {
    vi.mocked(listPlays).mockRejectedValue(new Error('offline'));
    show();
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain('연주 기록을 불러오지 못했어요');
    vi.mocked(listPlays).mockReset().mockResolvedValue(page([]));
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('아직 연주 기록이 없어요')).toBeTruthy();
  });

  it('리포트가 없는 서버 전용 기록은 링크를 만들지 않는다', async () => {
    vi.mocked(listPlays).mockResolvedValue(page([summary({ hasReport: false })]));
    show();
    expect(await screen.findByText('리포트 없음')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('계정 변경 뒤 늦게 도착한 이전 계정 응답을 표시하지 않는다', async () => {
    let resolveFirst!: (res: PageResponse<PlaySummary>) => void;
    vi.mocked(listPlays).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(page([summary({ playId: 'second', songTitle: '두 번째 계정' })]));
    show();
    act(() => login(2));
    expect(await screen.findByText('두 번째 계정')).toBeTruthy();
    await act(async () => resolveFirst(page([summary({ songTitle: '이전 계정' })])));
    await waitFor(() => expect(screen.queryByText('이전 계정')).toBeNull());
  });

  it('다시 들어오면 30초 안에는 요청하지 않는다(TECH-351)', async () => {
    vi.mocked(listPlays).mockResolvedValue(page([summary()]));
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    cleanup();
    show();
    expect(screen.getByText('서버 곡')).toBeTruthy();
    expect(listPlays).toHaveBeenCalledTimes(1);
  });
});

describe('아직 서버에 없는 기록', () => {
  it('서버 목록에 있는 로그는 겹쳐 보이지 않고, 저장이 끝난 로그는 섞지 않는다', async () => {
    storeLogs([local('remote'), local('done', { upload: up('DONE') }), local('old')]);
    vi.mocked(listPlays).mockResolvedValue(page([summary()]));
    show();
    expect(await screen.findByText('서버 곡')).toBeTruthy();
    expect(titles()).toEqual(['서버 곡', '로컬 old']);
    expect(count()).toBe('2개 기록');
  });

  it('옛 로그는 「저장 안 됨」과 결과 링크', async () => {
    storeLogs([local('old')]);
    vi.mocked(listPlays).mockResolvedValue(page([]));
    show();
    expect(await screen.findByText('저장 안 됨')).toBeTruthy();
    expect(screen.getByRole('link', { name: '로컬 old 결과 보기' }).getAttribute('href')).toBe('/result/old');
    expect(startPlaySync).not.toHaveBeenCalled();
  });

  it('올리다 끊긴 로그는 「저장 중…」으로 보이고 들어올 때 다시 보낸다', async () => {
    storeLogs([local('cut', { upload: up('UPLOADING') })]);
    vi.mocked(listPlays).mockResolvedValue(page([]));
    show();
    expect((await screen.findByRole('status')).textContent).toBe('저장 중…');
    await waitFor(() => expect(startPlaySync).toHaveBeenCalledWith('cut'));
    expect(startPlaySync).toHaveBeenCalledTimes(1);
  });

  it('저장 실패는 [다시 시도]로 다시 보내고, 저장이 끝나면 목록에서 빠진다', async () => {
    storeLogs([local('fail', { upload: up('FAILED', true) })]);
    vi.mocked(listPlays).mockResolvedValue(page([]));
    show();
    expect(await screen.findByText('저장 실패')).toBeTruthy();
    expect(startPlaySync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(startPlaySync).toHaveBeenCalledWith('fail');
    // 재전송 진행 → 완료(이번 접속 상태가 저장된 값보다 먼저다)
    act(() => usePlaySync.setState({ states: { fail: up('UPLOADING') } }));
    expect(screen.getByRole('status').textContent).toBe('저장 중…');
    act(() => usePlaySync.setState({ states: { fail: up('DONE') } }));
    await waitFor(() => expect(screen.queryByText('로컬 fail')).toBeNull());
  });

  it('검색·모드 조건은 서버에 없는 기록에도 똑같이 적용한다', async () => {
    storeLogs([local('x', { title: '별빛 로컬' }), local('y', { title: '다른 곡', mode: 'SHEET' })]);
    vi.mocked(listPlays).mockResolvedValue(page([]));
    show();
    await waitFor(() => expect(titles()).toEqual(['별빛 로컬', '다른 곡']));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '별빛' } });
    await waitFor(() => expect(titles()).toEqual(['별빛 로컬']));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: '악보 연습' }));
    await waitFor(() => expect(titles()).toEqual(['다른 곡']));
  });

  it('다음 쪽이 남았으면 받은 범위보다 오래된 것은 아직 섞지 않는다', async () => {
    storeLogs([local('new', { startedAt: '2026-11-02T00:00:00Z' }), local('older', { startedAt: '2026-10-01T00:00:00Z' })]);
    vi.mocked(listPlays).mockImplementation(async (p) =>
      p?.page === 0 ? page([summary()], { totalElements: 2, totalPages: 2, hasNext: true }) : page([summary({ playId: 'r2', songTitle: '옛 서버 곡', endedAt: '2026-09-01T00:00:00Z' })], { page: 1, totalElements: 2, totalPages: 2 }),
    );
    show();
    await screen.findByText('서버 곡');
    expect(titles()).toEqual(['로컬 new', '서버 곡']);
    expect(count()).toBe('4개 기록');
    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    await screen.findByText('옛 서버 곡');
    expect(titles()).toEqual(['로컬 new', '서버 곡', '로컬 older', '옛 서버 곡']);
  });

  it('서버 오류여도 서버에 없는 기록은 그대로 보이고 오류 줄에서 다시 시도할 수 있다', async () => {
    storeLogs([local('old')]);
    vi.mocked(listPlays).mockRejectedValue(new Error('offline'));
    show();
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain('서버 기록을 불러오지 못했어요');
    expect(titles()).toEqual(['로컬 old']);
  });
});
