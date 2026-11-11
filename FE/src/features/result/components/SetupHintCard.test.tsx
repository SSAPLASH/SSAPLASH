import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SetupHintCard } from './SetupHintCard';

const html = (tags: string[]) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <SetupHintCard tags={tags} returnTo="/result/1" />
    </MemoryRouter>,
  );

describe('SetupHintCard', () => {
  it('세팅 안내가 없던 판에서는 보이지 않는다', () => {
    expect(html([])).toBe('');
    expect(html(['LIVE_LATE'])).toBe('');
  });

  it('소리 지연 안내는 설정으로 보낸다', () => {
    const out = html(['LIVE_SETUP_OFFSET']);
    expect(out).toContain('href="/settings"');
    expect(out).not.toContain('href="/setup"');
  });

  it('패드 안내는 세팅으로 보낸다', () => {
    const out = html(['LIVE_SETUP_PADS']);
    expect(out).toContain('href="/setup"');
    expect(out).not.toContain('href="/settings"');
  });

  it('둘 다 떴으면 둘 다 보인다', () => {
    const out = html(['LIVE_SETUP_OFFSET', 'LIVE_SETUP_PADS']);
    expect(out).toContain('href="/settings"');
    expect(out).toContain('href="/setup"');
  });
});
