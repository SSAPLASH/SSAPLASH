import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StickStatusChip, StickStatusIndicator } from './StickStatusIndicator';
import { StickCard } from '@/features/setup/components/StickCard';

function render(
  connected: [boolean, boolean],
  battery: [number | null, number | null],
  pedal?: { connected: readonly [boolean, boolean]; battery: number | null },
  skewed?: readonly ('left' | 'right' | 'pedal')[],
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StickStatusChip connected={connected} battery={battery} pedal={pedal} skewed={skewed} />
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

describe('StickStatusChip 페달 조각', () => {
  it('페달 조각이 있으면 aria-label에도 페달이 들어간다(E7)', () => {
    const html = render([true, true], [82, 64], { connected: [true, true], battery: 90 });
    expect(html).toContain('aria-label="스틱·페달 연결 상태"');
    expect(html).toContain('페달');
  });

  // 인수 조건: pedal prop이 없으면(동글이 아닌 소스) "페달" 글자가 없다
  it('pedal이 없으면 페달 조각이 없다', () => {
    expect(render([true, true], [82, 64])).not.toContain('페달');
  });

  // 인수 조건: 두 발 연결 + 배터리 82 → "페달"·"82%"·on 점 (손은 끊김으로 둬 off 점이 손 몫임을 구분)
  it('양발 연결이면 페달·배터리·on 점', () => {
    const html = render([true, true], [null, null], { connected: [true, true], battery: 82 });
    expect(html).toContain('페달');
    expect(html).toContain('82%');
    expect(html.match(/stick-dot on/g)).toHaveLength(3);
    expect(html).not.toContain('stick-dot off');
  });

  // 인수 조건: 한 발만 붙으면 페달 점은 off
  it('한 발만 붙으면 페달 점이 off', () => {
    const html = render([true, true], [82, 64], { connected: [true, false], battery: 82 });
    expect(html).toContain('페달');
    expect(html.match(/stick-dot off/g)).toHaveLength(1);
    expect(html.match(/stick-dot on/g)).toHaveLength(2);
  });
});

describe('StickStatusChip 시간 어긋남 경고 (PLAY-006)', () => {
  it('경고가 없으면 지금과 같다(warn 없음, 접근성 이름도 그대로)', () => {
    const html = render([true, true], [82, 64], { connected: [true, true], battery: 90 });
    expect(html).not.toContain('warn');
    expect(html).not.toContain('시간 어긋남');
    expect(html).toContain('aria-label="스틱·페달 연결 상태"');
  });

  it('경고 기기의 점에만 warn이 붙고 title·aria-label에 「시간 어긋남」이 들어간다', () => {
    const html = render([true, true], [82, 64], { connected: [true, true], battery: 90 }, ['left']);
    expect(html.match(/stick-dot on warn/g)).toHaveLength(1);
    expect(html.match(/stick-dot on"/g)).toHaveLength(2);
    expect(html).toContain('title="왼손 연결됨 · 82% · 시간 어긋남"');
    expect(html).toContain('aria-label="스틱·페달 연결 상태 · 시간 어긋남"');
  });

  it('페달이 경고 기기면 페달 점이 warn', () => {
    const html = render([true, true], [82, 64], { connected: [true, true], battery: 90 }, ['pedal']);
    expect(html.match(/stick-dot on warn/g)).toHaveLength(1);
    expect(html).toMatch(/페달<span class="stick-dot on warn"/);
  });

  it('연결되지 않은 기기에는 warn을 붙이지 않는다', () => {
    const html = render([false, true], [null, 64], undefined, ['left', 'right']);
    expect(html.match(/stick-dot off warn/g)).toBeNull();
    expect(html.match(/stick-dot on warn/g)).toHaveLength(1);
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
