import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingSummary } from '@/domain/play/recording';
import { RecordingTitleDialog } from './RecordingTitleDialog';

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
  renderToStaticMarkup(<RecordingTitleDialog item={item} onSaved={() => {}} onMissing={() => {}} onClose={() => {}} />);

describe('RecordingTitleDialog', () => {
  it('제목과 입력칸: 라벨·초기 값·maxLength·안내', () => {
    const html = render();
    expect(html).toContain('>녹음 제목 변경<');
    expect(html).toContain('>제목</label>');
    expect(html).toContain('value="내 연주"');
    expect(html).toContain('maxLength="100"');
    expect(html).toContain('1~100자');
  });

  it('닫기 버튼과 [취소][저장] 구성', () => {
    const html = render();
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain('>취소<');
    expect(html).toContain('type="submit"');
    expect(html).toContain('>저장<');
    expect(html).not.toContain('저장 중…');
    expect(html).not.toContain('role="alert"');
  });

  it('폭 480 클래스', () => {
    expect(render()).toContain('rec-list-dialog-info');
  });
});
