import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetError } from '@/features/studio/domain/sheetMusic';
import { resetForTest } from '@/api/account/auth';
import { deleteSheet, getSheet, linkSheetToSong, listSheets, updateSheetTitle, uploadSheet } from './sheets';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const summary = { id: 5, title: '악보', source: 'UPLOADED', kind: 'IMAGE', pageCount: 2, totalBytes: 10, thumbnailUrl: 'https://x/t.png', createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:00:00Z' };
const detail = {
  ...summary,
  pages: [
    { pageNo: 2, url: 'https://x/2.png', contentType: 'image/png', width: 100, height: 200, bytes: 1 },
    { pageNo: 1, url: 'https://x/1.png', contentType: 'image/png', width: 100, height: 200, bytes: 1 },
  ],
  expiresAt: '2026-11-06T02:00:00Z',
};

function stub(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    body === undefined ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function formOf(fn: ReturnType<typeof stub>, i: number): FormData {
  return (fn.mock.calls[i][1] as RequestInit).body as FormData;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('listSheets', () => {
  it('size=100으로 부르고 songId가 없으면 null, 썸네일이 없으면 null', async () => {
    const fn = stub(200, { items: [summary, { ...summary, id: 6, kind: 'PDF', thumbnailUrl: null, songId: 3 }], hasNext: false });
    const page = await listSheets();
    expect(fn.mock.calls[0][0]).toBe('/api/v1/sheets?page=0&size=100');
    expect(page.items.map((s) => [s.id, s.kind, s.songId, s.thumbnailUrl])).toEqual([
      [5, 'IMAGE', null, 'https://x/t.png'],
      [6, 'PDF', 3, null],
    ]);
    expect(page.hasNext).toBe(false);
  });
});

describe('getSheet', () => {
  it('쪽을 번호순으로, expiresAt을 ms로 바꾼다', async () => {
    const fn = stub(200, detail);
    const d = await getSheet(5);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/sheets/5');
    expect(d.pages.map((p) => p.pageNo)).toEqual([1, 2]);
    expect(d.expiresAt).toBe(Date.parse('2026-11-06T02:00:00Z'));
    expect(d.songId).toBeNull();
  });
});

describe('uploadSheet', () => {
  it('files를 순서대로 반복하고 title을 보내며 songId가 없으면 그 파트가 없다', async () => {
    const fn = stub(201, detail);
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    const d = await uploadSheet({ files: [a, b], title: ' 악보 ' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/sheets');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect((form.getAll('files') as File[]).map((f) => f.name)).toEqual(['a.png', 'b.png']);
    expect(form.getAll('title')).toEqual(['악보']);
    expect(form.has('songId')).toBe(false);
    expect(form.has('source')).toBe(false);
    expect(d.id).toBe(5);
  });

  it('songId가 null이면 보내지 않고, 값이 있으면 한 번 보낸다', async () => {
    const fn = stub(201, detail);
    const f = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    await uploadSheet({ files: [f], title: 't', songId: null });
    expect(formOf(fn, 0).has('songId')).toBe(false);
    await uploadSheet({ files: [f], title: 't', songId: 9 });
    expect(formOf(fn, 1).getAll('songId')).toEqual(['9']);
  });
});

describe('updateSheetTitle·deleteSheet', () => {
  it('PATCH는 {title}만 JSON으로 보낸다', async () => {
    const fn = stub(200, { ...detail, title: '새 제목' });
    const d = await updateSheetTitle(5, ' 새 제목 ');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/sheets/5');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ title: '새 제목' });
    expect(d.title).toBe('새 제목');
  });

  it('DELETE는 204를 받는다', async () => {
    const fn = stub(204, undefined);
    await expect(deleteSheet(5)).resolves.toBeUndefined();
    expect(fn.mock.calls[0][1]?.method).toBe('DELETE');
  });
});

describe('linkSheetToSong', () => {
  it('PATCH 본문은 {songId}만 보내고 악보 상세를 돌려준다', async () => {
    const fn = stub(200, { ...detail, songId: 9 });
    const d = await linkSheetToSong(5, 9);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/sheets/5');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ songId: 9 });
    expect(d.songId).toBe(9);
  });

  it('null이면 해제 요청으로 {songId: null}을 보낸다', async () => {
    const fn = stub(200, detail);
    await linkSheetToSong(5, null);
    expect(JSON.parse(String(fn.mock.calls[0][1]?.body))).toEqual({ songId: null });
  });

  it.each([
    [404, 'SONG_NOT_FOUND'],
    [409, 'SHEET_ALREADY_LINKED'],
    [400, 'SHEET_INVALID'],
  ])('%i %s는 SheetError로', async (status, code) => {
    stub(status, { code, detail: '문제' });
    const e = await linkSheetToSong(5, 9).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SheetError);
    expect((e as SheetError).code).toBe(code);
  });
});

describe('오류 코드 변환', () => {
  it.each([
    [400, 'SHEET_INVALID'],
    [404, 'SHEET_NOT_FOUND'],
    [409, 'SHEET_ALREADY_LINKED'],
    [413, 'SHEET_QUOTA_EXCEEDED'],
    [415, 'SHEET_UNSUPPORTED'],
    [503, 'SHEET_UNAVAILABLE'],
  ])('%i %s는 SheetError로', async (status, code) => {
    stub(status, { code, detail: '문제' });
    const e = await getSheet(1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SheetError);
    expect((e as SheetError).code).toBe(code);
    expect((e as SheetError).status).toBe(status);
  });

  it('네트워크 실패는 NETWORK·status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fail');
      }),
    );
    const e = await listSheets().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SheetError);
    expect((e as SheetError).code).toBe('NETWORK');
    expect((e as SheetError).status).toBe(0);
  });
});
