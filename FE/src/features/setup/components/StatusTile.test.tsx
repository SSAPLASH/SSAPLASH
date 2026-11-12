// 상태 타일 SSR 검증(Figma Setup / StatusTile 505:2449, PLAY-004 D8): on/off/urgent/attention 색, 상태·요약·버튼 문구, 비활성.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusTile } from './StatusTile';

const noop = () => {};
const render = (over: Partial<Parameters<typeof StatusTile>[0]> = {}) =>
  renderToStaticMarkup(
    <StatusTile id="step-stick" title="스틱 연결" status="done" statusText="연결됨" summary="왼손·오른손 연결됨" actionText="보기" onOpen={noop} {...over} />,
  );

describe('StatusTile', () => {
  it('완료면 is-on, 제목·상태·요약·[보기] 문구가 보이고 펼침 본문은 없다', () => {
    const html = render();
    expect(html).toContain('class="setup-tile is-on"');
    expect(html).toContain('>스틱 연결<');
    expect(html).toContain('>연결됨<');
    expect(html).toContain('왼손·오른손 연결됨');
    expect(html).toContain('>보기<');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('aria-expanded');
  });

  it('필요면 is-off, 강조하면 is-attention, 복귀 띠가 떠 있으면 is-urgent', () => {
    const needed = { status: 'needed', statusText: '연결 안 됨', actionText: '연결하기' } as const;
    expect(render(needed)).toContain('class="setup-tile is-off"');
    expect(render({ ...needed, attention: true })).toContain('class="setup-tile is-attention"');
    expect(render({ ...needed, attention: true, urgent: true })).toContain('class="setup-tile is-urgent"');
    expect(render({ ...needed, attention: true })).toContain('>연결하기<');
    expect(render({ status: 'skipped', statusText: '필요 없음', attention: true })).toContain('class="setup-tile is-off"');
  });

  it('statusWarn이면 is-todo를 더하고, 없으면 붙이지 않는다', () => {
    const needed = { status: 'needed', statusText: '안 맞춤' } as const;
    expect(render({ ...needed, statusWarn: true })).toContain('class="setup-tile is-off is-todo"');
    expect(render(needed)).not.toContain('is-todo');
  });

  it('비활성이면 disabled와 이유 문구가 보인다', () => {
    const html = render({ disabled: true, reason: '보정 중에는 열 수 없어요' });
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('보정 중에는 열 수 없어요');
  });
});
