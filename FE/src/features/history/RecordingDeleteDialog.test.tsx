import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingSummary } from '@/domain/play/recording';
import { RecordingDeleteDialog } from './RecordingDeleteDialog';

vi.mock('@/api/play/recordings');

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
  it('제목·녹음 이름(꺾쇠 없이)·안내 문구', () => {
    const html = render();
    expect(html).toContain('>녹음 삭제<');
    expect(html).toContain('class="rec-list-delete-question">내 연주<');
    expect(html).not.toContain('「내 연주」');
    expect(html).toContain('이 녹음을 삭제할까요? 녹음 파일이 지워지고 되돌릴 수 없어요.');
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
    // 두 버튼이 폭을 나눠 채우는 배치는 .rec-list-dialog-delete .rec-list-footer-btn 규칙이 맡는다
    expect(html.match(/rec-list-footer-btn/g)).toHaveLength(2);
  });
});
