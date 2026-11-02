import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { SongDeleteDialog } from './SongDeleteDialog';

const song = { id: 7, title: '별빛 산책' } as SongSummary;
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
