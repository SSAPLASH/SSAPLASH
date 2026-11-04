import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingSummary } from '@/domain/recording';
import { RecordingDeleteDialog } from './RecordingDeleteDialog';

vi.mock('@/api/recordings');

const item: RecordingSummary = {
  id: 1,
  clientKey: 'k1',
  title: '내 연주',
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: 10,
  durationMs: 1000,
  startedAt: '2026-11-03T05:05:00Z',
  createdAt: '2026-11-03T05:06:00Z',
  updatedAt: '2026-11-03T05:06:00Z',
  song: null,
};

const render = () =>
  renderToStaticMarkup(<RecordingDeleteDialog item={item} onDeleted={() => {}} onMissing={() => {}} onClose={() => {}} />);

describe('RecordingDeleteDialog', () => {
  it('제목·질문·안내', () => {
    const html = render();
    expect(html).toContain('>녹음 삭제<');
    expect(html).toContain('「내 연주」을 삭제할까요?');
    expect(html).toContain('되돌릴 수 없어요.');
  });

  it('[취소] secondary와 [삭제] danger 버튼', () => {
    const html = render();
    expect(html).toContain('>취소<');
    expect(html).toContain('>삭제<');
    const danger = html.slice(html.lastIndexOf('<button'));
    expect(danger).toContain('danger');
    expect(danger).toContain('>삭제<');
    expect(html).not.toContain('삭제 중…');
    expect(html).toContain('rec-list-dialog-delete');
  });
});
