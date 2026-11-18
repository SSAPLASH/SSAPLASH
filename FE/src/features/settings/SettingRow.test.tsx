import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingRow } from './SettingRow';

describe('SettingRow', () => {
  it('라벨·도움말 id가 control의 aria 속성으로 이어진다', () => {
    const html = renderToStaticMarkup(
      <SettingRow label="실시간 코칭" help="도움말 문구">
        {(aria) => <button type="button" {...aria} />}
      </SettingRow>,
    );
    const label = /id="([^"]+)" class="settings-row-label"/.exec(html)?.[1];
    const help = /id="([^"]+)" class="settings-row-help"/.exec(html)?.[1];
    expect(label).toBeTruthy();
    expect(help).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${label}"`);
    expect(html).toContain(`aria-describedby="${help}"`);
  });

  it('도움말이 없으면 도움말 요소 없이 describedby가 라벨을 가리킨다', () => {
    const html = renderToStaticMarkup(<SettingRow label="라벨">{(aria) => <button type="button" {...aria} />}</SettingRow>);
    expect(html).not.toContain('settings-row-help');
    const label = /id="([^"]+)" class="settings-row-label"/.exec(html)?.[1];
    expect(html).toContain(`aria-describedby="${label}"`);
  });

  it('wideControl이면 control 슬롯에 wide 클래스', () => {
    const wide = renderToStaticMarkup(
      <SettingRow label="a" wideControl>
        {() => null}
      </SettingRow>,
    );
    const normal = renderToStaticMarkup(<SettingRow label="a">{() => null}</SettingRow>);
    expect(wide).toContain('settings-row-control wide');
    expect(normal).not.toContain('wide');
  });
});
