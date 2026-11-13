import { describe, expect, it } from 'vitest';
import { mergeLibraryItems, needsRefresh, sheetErrorCodeOf, sheetErrorText, SheetError, validateSheetFiles, type SheetSummary } from './sheetMusic';
import type { SongSummary } from '@/domain/song/songCatalog';

const MB = 1024 * 1024;
const img = (size = 1 * MB, name = 'a.png', type = 'image/png') => ({ name, type, size });
const pdf = (size = 1 * MB) => ({ name: 'a.pdf', type: 'application/pdf', size });

describe('validateSheetFiles', () => {
  it('비었으면 EMPTY', () => {
    expect(validateSheetFiles([])).toEqual({ ok: false, kind: null, reason: 'EMPTY' });
  });

  it('이미지 여러 장·PDF 하나는 통과', () => {
    expect(validateSheetFiles([img(), img(1, 'b.jpg', 'image/jpeg'), img(1, 'c.webp', 'image/webp')])).toEqual({ ok: true, kind: 'IMAGE' });
    expect(validateSheetFiles([pdf()])).toEqual({ ok: true, kind: 'PDF' });
  });

  it('type이 비면 확장자로 본다', () => {
    expect(validateSheetFiles([img(1, 'a.JPG', '')]).ok).toBe(true);
    expect(validateSheetFiles([{ name: 'a.pdf', type: '', size: 1 }])).toEqual({ ok: true, kind: 'PDF' });
  });

  it('이미지와 PDF가 섞이면 MIXED', () => {
    expect(validateSheetFiles([img(), pdf()]).reason).toBe('MIXED');
  });

  it('PDF 2개·이미지 21장은 TOO_MANY, 20장은 통과', () => {
    expect(validateSheetFiles([pdf(), pdf()]).reason).toBe('TOO_MANY');
    expect(validateSheetFiles(Array.from({ length: 21 }, () => img())).reason).toBe('TOO_MANY');
    expect(validateSheetFiles(Array.from({ length: 20 }, () => img())).ok).toBe(true);
  });

  it('GIF 등은 UNSUPPORTED', () => {
    expect(validateSheetFiles([img(1, 'a.gif', 'image/gif')]).reason).toBe('UNSUPPORTED');
    expect(validateSheetFiles([img(), { name: 'a.txt', type: 'text/plain', size: 1 }]).reason).toBe('UNSUPPORTED');
  });

  it('이미지 10MiB·PDF 20MiB 초과는 TOO_LARGE, 경계값은 통과', () => {
    expect(validateSheetFiles([img(10 * MB + 1)]).reason).toBe('TOO_LARGE');
    expect(validateSheetFiles([img(10 * MB)]).ok).toBe(true);
    expect(validateSheetFiles([pdf(20 * MB + 1)]).reason).toBe('TOO_LARGE');
    expect(validateSheetFiles([pdf(20 * MB)]).ok).toBe(true);
    // 이미지 한도(10MiB)를 넘어도 PDF는 20MiB 기준이다
    expect(validateSheetFiles([pdf(15 * MB)]).ok).toBe(true);
  });
});

describe('sheetErrorText', () => {
  it('검사 원인과 BE 코드를 문구 표대로 바꾼다', () => {
    expect(sheetErrorText('MIXED')).toBe('이미지와 PDF를 함께 올릴 수 없어요');
    expect(sheetErrorText('TOO_MANY')).toBe('이미지는 20장까지, PDF는 1개만 올릴 수 있어요');
    expect(sheetErrorText('UNSUPPORTED')).toBe('JPG·PNG·WEBP 이미지나 PDF만 올릴 수 있어요');
    expect(sheetErrorText('SHEET_UNSUPPORTED')).toBe(sheetErrorText('UNSUPPORTED'));
    expect(sheetErrorText('SHEET_TOO_LARGE')).toBe('이미지는 장당 10MB, PDF는 20MB까지예요');
    expect(sheetErrorText('SHEET_QUOTA_EXCEEDED')).toBe('악보는 100개·500MB까지 보관할 수 있어요');
    expect(sheetErrorText('SHEET_ALREADY_LINKED')).toBe('이 곡에는 이미 악보가 있어요');
    expect(sheetErrorText('SONG_NOT_FOUND')).toBe('곡을 찾을 수 없어요. 목록을 새로 고쳐 주세요');
    expect(sheetErrorText('SHEET_INVALID')).toBe('파일을 읽을 수 없어요. 다른 파일로 올려 주세요');
  });

  it('SHEET_UNAVAILABLE·NETWORK·모르는 코드는 일시 오류 문구', () => {
    const t = '지금은 올릴 수 없어요. 잠시 뒤 다시 시도해 주세요';
    expect(sheetErrorText('SHEET_UNAVAILABLE')).toBe(t);
    expect(sheetErrorText('NETWORK')).toBe(t);
    expect(sheetErrorText('???')).toBe(t);
  });

  it('sheetErrorCodeOf는 code를 읽고 없으면 NETWORK', () => {
    expect(sheetErrorCodeOf(new SheetError('SHEET_TOO_LARGE', 413))).toBe('SHEET_TOO_LARGE');
    expect(sheetErrorCodeOf(new Error('x'))).toBe('NETWORK');
    expect(sheetErrorCodeOf(null)).toBe('NETWORK');
  });
});

describe('needsRefresh', () => {
  const exp = 10_000_000;
  it('만료 2분 전부터 참', () => {
    expect(needsRefresh(exp, exp - 120_001)).toBe(false);
    expect(needsRefresh(exp, exp - 120_000)).toBe(true);
    expect(needsRefresh(exp, exp + 1)).toBe(true);
  });
});

function song(id: number, status: string, createdAt: string): SongSummary {
  return { id, status, createdAt } as SongSummary;
}
function sheet(id: number, createdAt: string, songId: number | null = null): SheetSummary {
  return { id, title: `악보${id}`, kind: 'IMAGE', pageCount: 1, thumbnailUrl: null, createdAt, songId };
}
const tag = (items: ReturnType<typeof mergeLibraryItems>) => items.map((i) => (i.type === 'song' ? `s${i.song.id}` : `h${i.sheet.id}`));

describe('mergeLibraryItems', () => {
  const songs = [song(1, 'READY', '2026-11-01T00:00:00Z'), song(2, 'PROCESSING', '2026-10-01T00:00:00Z'), song(3, 'FAILED', '2026-10-02T00:00:00Z')];

  it('처리 중 → 실패 → 그 밖(곡·악보 섞어 createdAt 내림차순)', () => {
    const sheets = [sheet(10, '2026-11-02T00:00:00Z'), sheet(11, '2026-10-30T00:00:00Z')];
    expect(tag(mergeLibraryItems(songs, sheets, false))).toEqual(['s2', 's3', 'h10', 's1', 'h11']);
  });

  it('링크 꺼짐: songId가 있어도 악보 항목으로 넣는다', () => {
    const sheets = [sheet(10, '2026-11-02T00:00:00Z', 1)];
    expect(tag(mergeLibraryItems(songs, sheets, false))).toContain('h10');
  });

  it('링크 켜짐: 목록의 곡을 가리키는 악보는 빼고, 곡이 없거나 songId가 null이면 넣는다', () => {
    const sheets = [sheet(10, '2026-11-02T00:00:00Z', 1), sheet(11, '2026-11-03T00:00:00Z', 999), sheet(12, '2026-11-04T00:00:00Z', null)];
    expect(tag(mergeLibraryItems(songs, sheets, true))).toEqual(['s2', 's3', 'h12', 'h11', 's1']);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const copy = [...songs];
    mergeLibraryItems(songs, [], true);
    expect(songs).toEqual(copy);
  });
});
