import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WithdrawDialog } from './WithdrawDialog';

const noop = () => {};

describe('WithdrawDialog 마크업', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<WithdrawDialog open={false} busy={false} error={null} onCancel={noop} onConfirm={noop} />)).toBe('');
  });

  it('취소는 secondary md, 탈퇴는 danger md 버튼', () => {
    const html = renderToStaticMarkup(<WithdrawDialog open busy={false} error={null} onCancel={noop} onConfirm={noop} />);
    expect(html).toMatch(/ui-btn-secondary ui-btn-md[^>]*>취소</);
    expect(html).toMatch(/ui-btn-danger ui-btn-md[^>]*>탈퇴</);
    expect(html).not.toContain('btn-ghost');
  });

  it('진행 중이면 두 버튼이 비활성이고 문구가 바뀐다', () => {
    const html = renderToStaticMarkup(<WithdrawDialog open busy error={null} onCancel={noop} onConfirm={noop} />);
    expect(html).toMatch(/ui-btn-danger[^>]*disabled=""[^>]*>탈퇴 중…/);
  });
});
