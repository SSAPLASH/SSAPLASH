import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HowtoPanel } from './HowtoPanel';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('HowtoPanel', () => {
  it('panel: 제목, 4단계(번호·제목·설명), 한 곡씩 생성 노트', () => {
    const html = renderToStaticMarkup(<HowtoPanel variant="panel" />);
    expect(html).toContain('어떻게 되나요');
    expect(count(html, 'class="studio-howto-step"')).toBe(4);
    for (const t of ['접수', '드럼 분리', '채보 생성', '완료']) expect(html).toContain(`>${t}<`);
    expect(html).toContain('악보를 확인하거나 바로 플레이할 수 있어요');
    expect(html).toContain('생성은 한 번에 한 곡만 할 수 있어요');
    expect(html).toContain('studio-howto-note');
  });

  it('steps: 가로 4칸이고 4번 설명이 짧은 문구로 바뀐다', () => {
    const html = renderToStaticMarkup(<HowtoPanel variant="steps" />);
    expect(count(html, 'class="studio-steps4-item"')).toBe(4);
    expect(html).toContain('악보 연습·플레이가 열려요');
    expect(html).not.toContain('악보를 확인하거나');
    expect(html).not.toContain('studio-howto-note');
    expect(html).toContain('곡이 만들어지는 순서');
  });
});
