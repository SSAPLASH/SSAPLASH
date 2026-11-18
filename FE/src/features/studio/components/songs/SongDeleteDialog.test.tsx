import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { SongDeleteDialog } from './SongDeleteDialog';

const song = { id: 7, title: '별빛 산책', sheetId: null } as SongSummary;
const noop = () => {};

describe('SongDeleteDialog 버튼', () => {
  it('[취소]는 secondary md, [삭제]는 danger md', () => {
    const html = renderToStaticMarkup(<SongDeleteDialog song={song} busy={false} error={null} onDelete={noop} onClose={noop} />);
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-md[^>]*>취소/);
    expect(html).toMatch(/ui-btn ui-btn-danger ui-btn-md[^>]*>삭제</);
    expect(html).toContain('studio-dialog-delete');
  });

  it('삭제 중이면 두 버튼과 ✕가 모두 막힌다', () => {
    const html = renderToStaticMarkup(<SongDeleteDialog song={song} busy error={null} onDelete={noop} onClose={noop} />);
    expect(html).toMatch(/ui-btn-secondary[^>]*disabled=""[^>]*>취소/);
    expect(html).toMatch(/ui-btn-danger[^>]*disabled=""[^>]*>삭제 중…/);
  });

  it('오류 문구는 alert로 보인다', () => {
    const html = renderToStaticMarkup(<SongDeleteDialog song={song} busy={false} error="실패했어요" onDelete={noop} onClose={noop} />);
    expect(html).toMatch(/role="alert"[^>]*>실패했어요/);
  });
});

describe('SongDeleteDialog 안내 문구', () => {
  it('악보가 없으면 채보·반주·커버만 함께 지워진다고 안내한다', () => {
    const html = renderToStaticMarkup(<SongDeleteDialog song={song} busy={false} error={null} onDelete={noop} onClose={noop} />);
    expect(html).toContain('채보·반주·커버가 함께 지워지고');
    expect(html).not.toContain('악보가');
  });

  it('악보가 없으면 현행 문구 그대로다', () => {
    const html = renderToStaticMarkup(<SongDeleteDialog song={song} busy={false} error={null} onDelete={noop} onClose={noop} />);
    expect(html).toContain('채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.');
  });

  it('연결된 악보가 있으면 악보와 연주 기록·결과가 남는다고 안내한다 (D18)', () => {
    const linked = { ...song, sheetId: 3 } as SongSummary;
    const html = renderToStaticMarkup(<SongDeleteDialog song={linked} busy={false} error={null} onDelete={noop} onClose={noop} />);
    expect(html).toContain('채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연결된 악보와 연주 기록·결과는 남아요.');
    expect(html).not.toContain('커버·악보가');
  });
});
