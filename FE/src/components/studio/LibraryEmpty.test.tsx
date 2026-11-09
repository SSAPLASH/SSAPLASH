import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LibraryEmpty } from './LibraryEmpty';

describe('LibraryEmpty (설계 QA-studio-empty-state)', () => {
  it('카드 보기는 점선 상자, 악보 기능이 켜져 있으면 곡과 악보 문구', () => {
    const html = renderToStaticMarkup(<LibraryEmpty view="card" sheetsEnabled />);
    expect(html).toContain('studio-empty card');
    expect(html).toContain('role="status"');
    expect(html).toContain('나만의 곡과 악보를 추가해 봐요!');
    expect(html).toContain('[+ 올리기]로 음원·MIDI·악보를');
  });

  it('목록 보기는 목록 틀 안 한 칸', () => {
    expect(renderToStaticMarkup(<LibraryEmpty view="list" sheetsEnabled />)).toContain('studio-empty list');
  });

  it('악보 기능이 꺼져 있으면 곡만 말한다', () => {
    const html = renderToStaticMarkup(<LibraryEmpty view="card" sheetsEnabled={false} />);
    expect(html).toContain('나만의 곡을 추가해 봐요!');
    expect(html).toContain('[+ 곡 올리기]로 음원이나 MIDI를');
    expect(html).not.toContain('악보');
  });

  it('버튼은 두지 않는다(올리기는 헤더 하나)', () => {
    expect(renderToStaticMarkup(<LibraryEmpty view="card" sheetsEnabled />)).not.toContain('<button');
  });
});
