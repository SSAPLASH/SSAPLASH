import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { RecordingSummary } from '@/domain/play/recording';
import { toastContent } from './toastContent';

const html = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('toastContent', () => {
  it('saved: 성공 문구와 보관함 링크', () => {
    const c = toastContent({ kind: 'saved', recording: {} as RecordingSummary });
    expect(c.variant).toBe('success');
    const out = html(c.text);
    expect(out).toContain('녹음을 저장했어요');
    expect(out).toContain('href="/history?tab=recordings"');
    expect(out).toContain('보관함');
  });

  it('noHits: 안내 문구', () => {
    const c = toastContent({ kind: 'noHits' });
    expect(c.variant).toBe('info');
    expect(c.text).toBe('타격이 없어 녹음을 저장하지 않았어요');
  });
});
