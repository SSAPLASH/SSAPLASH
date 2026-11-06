// 상태 타일 SSR 검증(Figma Setup / StatusTile 505:2449): on/off/urgent 색, 상태·요약 문구, 펼침 본문, › 아이콘.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusTile } from './StatusTile';

const noop = () => {};
const render = (over: Partial<Parameters<typeof StatusTile>[0]> = {}) =>
  renderToStaticMarkup(
    <StatusTile id="step-stick" title="스틱 연결" status="done" statusText="연결됨" summary="왼손·오른손 연결됨" expanded={false} onToggle={noop} {...over}>
      <p>본문</p>
    </StatusTile>,
  );

describe('StatusTile', () => {
  it('완료면 is-on, 제목·상태·요약·› 아이콘, 접힌 동안 본문 없음', () => {
    const html = render();
    expect(html).toContain('class="setup-tile is-on"');
    expect(html).toContain('>스틱 연결<');
    expect(html).toContain('>연결됨<');
    expect(html).toContain('왼손·오른손 연결됨');
    expect(html).toContain('src="/icons/chevron-next.svg"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('본문');
  });

  it('필요면 is-off, 복귀 띠가 떠 있으면 is-urgent', () => {
    expect(render({ status: 'needed', statusText: '연결 안 됨' })).toContain('class="setup-tile is-off"');
    expect(render({ status: 'needed', statusText: '연결 안 됨', urgent: true })).toContain('class="setup-tile is-urgent"');
    expect(render({ status: 'skipped', statusText: '필요 없음' })).toContain('class="setup-tile is-off"');
  });

  it('펼치면 본문 영역이 타일 아래에 그려진다', () => {
    const html = render({ expanded: true });
    expect(html).toContain('setup-tile-wrap expanded');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="step-stick-body"');
    expect(html).toContain('본문');
  });
});
