import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAdminSong, uploadAccompaniment } from './adminSongs';
import { ApiError } from '@/api/http';
import type { BulkRow } from './adminBulk';
import { adminErrorText, type AdminSongDraft } from './adminSong';
import { useAdminBulk } from './adminBulkStore';

vi.mock('./adminSongs', () => ({ registerAdminSong: vi.fn(), uploadAccompaniment: vi.fn() }));

const draft = (title: string, withAcc: boolean): AdminSongDraft => ({
  file: new File(['m'], `${title}.mid`), title, artist: '', license: 'x', offsetMs: '', published: true,
  accompaniment: withAcc ? new File(['a'], `${title}.mp3`) : null,
});
const row = (line: number, action: BulkRow['action'], title: string, withAcc = false, songId: number | null = null): BulkRow => ({
  line, title, action, message: null, draft: draft(title, withAcc), songId,
});
const apiError = (status: number, code: string) => new ApiError(status, code, '오류');

beforeEach(() => {
  vi.mocked(registerAdminSong).mockReset();
  vi.mocked(uploadAccompaniment).mockReset().mockResolvedValue(undefined);
});
afterEach(() => useAdminBulk.getState().reset());

describe('adminBulkStore.run', () => {
  it('등록·반주만은 차례로 실행하고 건너뜀·오류는 부르지 않는다', async () => {
    vi.mocked(registerAdminSong).mockResolvedValue({ id: 7, title: 'A', artist: null, license: 'x', status: 'READY', hasAccompaniment: false, published: true, difficulties: [] });
    await useAdminBulk.getState().run([row(2, 'REGISTER', 'A', true), row(3, 'ACCOMPANIMENT_ONLY', 'B', true, 5), row(4, 'SKIP', 'C'), row(5, 'ERROR', 'D')]);
    expect(registerAdminSong).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadAccompaniment).mock.calls.map((c) => c[0])).toEqual([7, 5]);
    const s = useAdminBulk.getState();
    expect(s.phase).toBe('done');
    expect(s.results).toEqual({
      2: { status: 'done', message: null },
      3: { status: 'done', message: null },
      4: { status: 'skipped', message: null },
      5: { status: 'skipped', message: null },
    });
    expect(s.summary).toEqual({ done: 2, failed: 0, skipped: 2 });
  });

  it('한 줄이 실패해도 다음 줄을 계속하고, 등록 뒤 반주 실패는 부분 실패로 남긴다', async () => {
    vi.mocked(registerAdminSong)
      .mockRejectedValueOnce(apiError(422, 'MIDI_UNSUPPORTED'))
      .mockResolvedValueOnce({ id: 8, title: 'B', artist: null, license: 'x', status: 'READY', hasAccompaniment: false, published: true, difficulties: [] });
    vi.mocked(uploadAccompaniment).mockRejectedValueOnce(apiError(422, 'ACCOMPANIMENT_UNSUPPORTED'));
    await useAdminBulk.getState().run([row(2, 'REGISTER', 'A'), row(3, 'REGISTER', 'B', true)]);
    const s = useAdminBulk.getState();
    expect(s.results[2]).toEqual({ status: 'failed', message: adminErrorText('MIDI_UNSUPPORTED') });
    expect(s.results[3].status).toBe('failed');
    expect(s.results[3].message).toContain('곡은 등록');
    expect(s.summary).toEqual({ done: 0, failed: 2, skipped: 0 });
  });

  it('반주 저장소를 못 쓰는 503은 저장소 문구로 남긴다', async () => {
    vi.mocked(uploadAccompaniment).mockRejectedValueOnce(apiError(503, 'ACCOMPANIMENT_UNAVAILABLE'));
    await useAdminBulk.getState().run([row(2, 'ACCOMPANIMENT_ONLY', 'A', true, 1)]);
    expect(useAdminBulk.getState().results[2]).toEqual({ status: 'failed', message: adminErrorText('ACCOMPANIMENT_UNAVAILABLE') });
  });

  it('실행 중에는 다시 실행하지 않는다', async () => {
    let release: () => void = () => {};
    vi.mocked(uploadAccompaniment).mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    const first = useAdminBulk.getState().run([row(2, 'ACCOMPANIMENT_ONLY', 'A', true, 1)]);
    await useAdminBulk.getState().run([row(2, 'ACCOMPANIMENT_ONLY', 'A', true, 1)]);
    expect(uploadAccompaniment).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(useAdminBulk.getState().phase).toBe('done');
  });
});
