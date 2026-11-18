import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { Toast } from '@/components/ui/feedback/Toast';

describe('Toast', () => {
  it('text가 null이어도 알림 영역은 있고 내용은 없다', () => {
    const html = renderToStaticMarkup(<Toast variant="info" text={null} regionClassName="region" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="region"');
    expect(html).not.toContain('ui-toast');
  });

  it.each(['info', 'success', 'error'] as const)('variant %s 클래스와 motion-toast', (v) => {
    const html = renderToStaticMarkup(<Toast variant={v} text="저장했어요" />);
    expect(html).toContain(`ui-toast-${v}`);
    expect(html).toContain('motion-toast');
    expect(html).toContain('<span class="ui-toast-text">저장했어요</span>');
  });
});

describe('Dialog', () => {
  it('.dialog-backdrop > .dialog 구조와 접근성 속성', () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => {}} labelledBy="t">
        <h2 id="t">제목</h2>
      </Dialog>,
    );
    expect(html.startsWith('<div class="dialog-backdrop"><div')).toBe(true);
    expect(html).toContain('class="dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain('<h2 id="t">제목</h2>');
  });

  it('label은 aria-label, 초기 초점 대상이 없으면 tabindex=-1', () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => {}} label="알림">
        x
      </Dialog>,
    );
    expect(html).toContain('aria-label="알림"');
    expect(html).toContain('tabindex="-1"');
  });

  it('as="form"이면 패널이 form 요소', () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => {}} as="form" labelledBy="t">
        x
      </Dialog>,
    );
    expect(html).toMatch(/<form [^>]*class="dialog"/);
    expect(html).toContain('role="dialog"');
    expect(html).not.toMatch(/<div class="dialog"/);
  });

  it('className을 합친다', () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => {}} className="upload-dialog">
        x
      </Dialog>,
    );
    expect(html).toContain('class="dialog upload-dialog"');
  });
});

describe('Menu', () => {
  it('닫힌 상태는 트리거만 그리고 aria-expanded=false·aria-haspopup', () => {
    const html = renderToStaticMarkup(
      <Menu
        className="wrap"
        menuClassName="pop"
        renderTrigger={({ triggerProps }) => (
          <button type="button" aria-haspopup={triggerProps['aria-haspopup']} aria-expanded={triggerProps['aria-expanded']}>
            열기
          </button>
        )}
      >
        <button role="menuitem">항목</button>
      </Menu>,
    );
    expect(html).toContain('class="wrap"');
    expect(html).toContain('data-align="end"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('열기');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('항목');
  });
});
