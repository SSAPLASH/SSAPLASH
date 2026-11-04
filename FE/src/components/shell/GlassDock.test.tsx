import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GlassDock } from './GlassDock';

describe('GlassDock 마크업', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GlassDock />
    </MemoryRouter>,
  );

  it('아이콘 버튼은 IconButton sm(BPM ±·접기)', () => {
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 감소"/);
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 증가"/);
    expect(html).toMatch(/ui-icon-btn-sm dock-collapse[^>]*aria-label="Dock 접기"/);
    expect(html).not.toContain('dock-icon-btn');
  });

  it('패드 소리·메트로놈 스위치는 role=switch와 aria-checked', () => {
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-checked="/g) ?? []).length).toBe(2);
  });
});

// 정적 렌더(서버 스냅샷)는 초기 스토어 값만 읽으므로 셸 모드·재생 전(playRunning=false)에는 저장 설정대로 펼쳐진다.
// 자동 접힘 타이머 동작은 dockAutoCollapse.test.ts에서 가짜 타이머로 검증한다.
describe('GlassDock 기본 상태', () => {
  it('playRunning 기본값 false면 펼친 Dock(셸 모드)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GlassDock />
      </MemoryRouter>,
    );
    expect(html).toContain('glass-dock shell');
    expect(html).not.toContain('collapsed');
  });
});
