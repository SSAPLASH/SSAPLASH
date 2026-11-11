import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SongStatusBadge } from './SongStatusBadge';

describe('SongStatusBadge', () => {
  it.each([
    ['READY', '완료', 'studio-badge-ok'],
    ['PROCESSING', '채보 생성 중', 'studio-badge-active'],
    ['FAILED', '생성 실패', 'studio-badge-danger'],
  ])('%s 상태는 「%s」 문구와 %s 클래스', (status, label, cls) => {
    const html = renderToStaticMarkup(<SongStatusBadge status={status} />);
    expect(html).toContain(label);
    expect(html).toContain(`studio-badge ${cls}`);
    expect(html).toContain('studio-badge-dot');
  });

  it('모르는 상태는 상태 문구 그대로, 완료 색', () => {
    const html = renderToStaticMarkup(<SongStatusBadge status="WEIRD" />);
    expect(html).toContain('WEIRD');
    expect(html).toContain('studio-badge-ok');
  });

  it('label을 주면 글자만 바꾸고 색·점은 status를 따른다', () => {
    const html = renderToStaticMarkup(<SongStatusBadge status="PROCESSING" label="반주 만드는 중" />);
    expect(html).toContain('반주 만드는 중');
    expect(html).not.toContain('채보 생성 중');
    expect(html).toContain('studio-badge-active');
    expect(html).toContain('studio-badge-dot');
  });
});
