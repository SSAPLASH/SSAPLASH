import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('네이티브 체크박스를 label로 감싸고 라벨을 보인다', () => {
    const html = renderToStaticMarkup(<Checkbox checked={false} onChange={() => {}} label="모두 동의합니다" />);
    expect(html).toMatch(/<label class="ui-checkbox" for="[^"]+"/);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('모두 동의합니다');
    expect(html).toContain('t-body-14');
  });

  it('checked면 input에 checked, labelStyle은 라벨 클래스로', () => {
    const html = renderToStaticMarkup(<Checkbox checked onChange={() => {}} label="x" labelStyle="body-16" />);
    expect(html).toContain('checked=""');
    expect(html).toContain('t-body-16');
  });

  it('id를 넘기면 input id와 label for가 같다', () => {
    const html = renderToStaticMarkup(<Checkbox id="agree" checked={false} onChange={() => {}} label="x" />);
    expect(html).toContain('for="agree"');
    expect(html).toContain('id="agree"');
  });

  it('disabled', () => {
    const html = renderToStaticMarkup(<Checkbox checked={false} onChange={() => {}} label="x" disabled />);
    expect(html).toContain('ui-checkbox-disabled');
    expect(html).toContain('disabled=""');
  });
});
