import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { SongDeleteDialog } from './SongDeleteDialog';

// 악보 재연결 스위치 켜짐(BE 회신 3 이후): 곡을 지워도 연결된 악보는 남는다 (D18)
vi.mock('@/config/features', async (orig) => ({ ...(await orig<typeof import('@/config/features')>()), SHEET_RELINK_ENABLED: true }));

const song = { id: 7, title: '별빛 산책', sheetId: null } as SongSummary;
const noop = () => {};
const html = (s: SongSummary) => renderToStaticMarkup(<SongDeleteDialog song={s} busy={false} error={null} onDelete={noop} onClose={noop} />);

describe('SongDeleteDialog 안내 문구 (재연결 켜짐)', () => {
  it('연결된 악보가 있으면 악보와 연주 기록·결과가 남는다고 안내한다', () => {
    const out = html({ ...song, sheetId: 3 } as SongSummary);
    expect(out).toContain('채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연결된 악보와 연주 기록·결과는 남아요.');
    expect(out).not.toContain('커버·악보가');
  });

  it('악보가 없으면 현행 문구 그대로다', () => {
    expect(html(song)).toContain('채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.');
  });
});
