import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StickStatusChip, StickStatusIndicator } from './StickStatusIndicator';
import { StickCard } from '../setup/StickCard';

function render(connected: [boolean, boolean], battery: [number | null, number | null]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StickStatusChip connected={connected} battery={battery} />
    </MemoryRouter>,
  );
}

describe('StickStatusChip', () => {
  it('좌우 점·배터리를 보이고 /setup으로 연결된다', () => {
    const html = render([true, false], [82, 64]);
    expect(html).toContain('aria-label="스틱 연결 상태"');
    expect(html).toContain('href="/setup"');
    expect(html).toContain('82%');
    expect(html).toContain('64%');
    expect(html).toContain('stick-dot on');
    expect(html).toContain('stick-dot off');
  });

  it('20% 이하는 low, 모르면 "–"', () => {
    const html = render([true, true], [15, null]);
    expect(html).toContain('stick-batt low');
    expect(html).toContain('stick-batt unknown');
    expect(html).toContain('–');
  });
});

describe('StickStatusIndicator', () => {
  it('키보드 전용(기본 설정)이면 렌더하지 않는다', () => {
    expect(
      renderToStaticMarkup(
        <MemoryRouter>
          <StickStatusIndicator />
        </MemoryRouter>,
      ),
    ).toBe('');
  });
});

describe('StickCard', () => {
  it('끊겼으면 스틱을 켜 달라는 안내를 보인다', () => {
    const html = renderToStaticMarkup(<StickCard hand={1} connected={false} batteryPct={40} />);
    expect(html).toContain('오른손');
    expect(html).toContain('연결 안 됨');
    expect(html).toContain('스틱 버튼을 눌러 켜 주세요');
    expect(html).not.toContain('<button');
  });
  it('연결되면 안내 없이 배터리를 보인다', () => {
    const html = renderToStaticMarkup(<StickCard hand={0} connected batteryPct={82} />);
    expect(html).toContain('연결됨');
    expect(html).toContain('82%');
    expect(html).not.toContain('스틱 버튼');
    expect(html).not.toContain('곧 꺼짐');
  });
  it('10% 이하면 빨간 배터리와 "곧 꺼짐"', () => {
    const html = renderToStaticMarkup(<StickCard hand={0} connected batteryPct={8} />);
    expect(html).toContain('stick-batt critical');
    expect(html).toContain('곧 꺼짐');
  });
});
