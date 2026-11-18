import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import { useSheetLink } from './sheetLinkStore';

const sheet: SheetSummary = {
  id: 10,
  title: '합주 악보',
  kind: 'IMAGE',
  pageCount: 2,
  thumbnailUrl: null,
  createdAt: '2026-11-01T01:00:00Z',
  songId: null,
};
const detail = { id: 10, title: '합주 악보', kind: 'IMAGE', pageCount: 2, createdAt: '2026-11-01T01:00:00Z', songId: 7, pages: [], expiresAt: '2026-11-01T02:00:00Z' };

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}
function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => {
  useSheetLink.getState().reset();
  vi.unstubAllGlobals();
});

describe('sheetLinkStore', () => {
  it('begin이 대상 악보를 지정하고 cancel이 푼다', () => {
    useSheetLink.getState().begin(sheet);
    expect(useSheetLink.getState().target).toEqual(sheet);
    useSheetLink.getState().cancel();
    expect(useSheetLink.getState().target).toBeNull();
  });

  it('link가 target 악보에 PATCH {songId}를 한 번 보내고 성공하면 target·pending을 비운다', async () => {
    const fn = mockFetch(() => json(200, detail));
    useSheetLink.getState().begin(sheet);
    await useSheetLink.getState().link(7);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/sheets/10');
    expect(JSON.parse(String(fn.mock.calls[0][1]?.body))).toEqual({ songId: 7 });
    expect(useSheetLink.getState()).toMatchObject({ phase: 'done', target: null, pending: null, error: null });
  });

  it('target이 없으면 요청하지 않는다', async () => {
    const fn = mockFetch(() => json(200, detail));
    await useSheetLink.getState().link(7);
    expect(fn).not.toHaveBeenCalled();
    expect(useSheetLink.getState().phase).toBe('idle');
  });

  it('실패하면 failed와 pending(악보·곡)을 남기고 사용자 문구를 보관한다', async () => {
    mockFetch(() => json(409, { status: 409, code: 'SHEET_ALREADY_LINKED', detail: 'x' }, 'application/problem+json'));
    useSheetLink.getState().begin(sheet);
    await useSheetLink.getState().link(7);
    expect(useSheetLink.getState()).toMatchObject({
      phase: 'failed',
      pending: { sheetId: 10, songId: 7 },
      error: '이 곡에는 이미 악보가 있어요',
    });
  });

  it('네트워크 실패도 failed이고 retry가 pending만 다시 PATCH해 성공하면 비운다', async () => {
    let n = 0;
    const fn = mockFetch(() => {
      n += 1;
      if (n === 1) throw new TypeError('network');
      return json(200, detail);
    });
    useSheetLink.getState().begin(sheet);
    await useSheetLink.getState().link(7);
    expect(useSheetLink.getState().phase).toBe('failed');
    await useSheetLink.getState().retry();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fn.mock.calls[1][1]?.body))).toEqual({ songId: 7 });
    expect(useSheetLink.getState()).toMatchObject({ phase: 'done', pending: null, error: null });
  });

  it('retry가 또 실패하면 pending이 그대로 남고, pending이 없으면 retry는 아무것도 안 한다', async () => {
    const fn = mockFetch(() => json(503, { status: 503, code: 'SHEET_UNAVAILABLE', detail: 'x' }, 'application/problem+json'));
    await useSheetLink.getState().retry();
    expect(fn).not.toHaveBeenCalled();
    useSheetLink.getState().begin(sheet);
    await useSheetLink.getState().link(7);
    await useSheetLink.getState().retry();
    expect(useSheetLink.getState()).toMatchObject({ phase: 'failed', pending: { sheetId: 10, songId: 7 } });
  });

  it('cancel은 실패 대상(pending)을 지우지 않고 reset은 모두 지운다', async () => {
    mockFetch(() => json(503, { status: 503, code: 'SHEET_UNAVAILABLE', detail: 'x' }, 'application/problem+json'));
    useSheetLink.getState().begin(sheet);
    await useSheetLink.getState().link(7);
    useSheetLink.getState().cancel();
    expect(useSheetLink.getState().pending).not.toBeNull();
    useSheetLink.getState().reset();
    expect(useSheetLink.getState()).toMatchObject({ target: null, pending: null, phase: 'idle', error: null });
  });
});
