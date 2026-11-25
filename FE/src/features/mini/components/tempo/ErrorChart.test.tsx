// @vitest-environment happy-dom
// ErrorChart·TempoResult 검증: 타격마다 벗어난 정도 그림의 클래스·세로 위치·글, 결과 본문 조립.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorChart } from './ErrorChart';
import { TempoResult } from './TempoResult';

afterEach(cleanup);

const hit = (i: number) => screen.getByTestId(`mini-tempo-hit-${i}`);
const cy = (i: number) => Number(hit(i).querySelector('circle')?.getAttribute('cy'));
const axisY = () => Number(document.querySelector('.mini-tempo-chart-axis')?.getAttribute('y1'));
const hits = () => Array.from(document.querySelectorAll('[data-testid^="mini-tempo-hit-"]'));

describe('ErrorChart', () => {
  it('오차마다 묶음 하나가 있고 data-error에 그 값이 들어 있다', () => {
    render(<ErrorChart errors={[0, 8, -12, 0]} scaleMs={40} />);
    expect(hits()).toHaveLength(4);
    expect(hit(0).getAttribute('data-error')).toBe('0');
    expect(hit(1).getAttribute('data-error')).toBe('8');
    expect(hit(2).getAttribute('data-error')).toBe('-12');
  });

  it('0은 is-exact, 음수는 is-early, 양수는 is-late', () => {
    render(<ErrorChart errors={[0, -5, 5]} scaleMs={40} />);
    expect(hit(0).classList.contains('is-exact')).toBe(true);
    expect(hit(1).classList.contains('is-early')).toBe(true);
    expect(hit(2).classList.contains('is-late')).toBe(true);
  });

  it('is-off는 절대 오차가 10을 넘을 때만 붙는다(10은 아니고 11은 맞다)', () => {
    render(<ErrorChart errors={[0, 10, -10, 11, -11]} scaleMs={40} />);
    expect(hit(0).classList.contains('is-off')).toBe(false);
    expect(hit(1).classList.contains('is-off')).toBe(false);
    expect(hit(2).classList.contains('is-off')).toBe(false);
    expect(hit(3).classList.contains('is-off')).toBe(true);
    expect(hit(4).classList.contains('is-off')).toBe(true);
  });

  it('빠른 타는 가운데 선 위에, 늦은 타는 아래에, 정박은 선 위에 점이 있다', () => {
    render(<ErrorChart errors={[0, -20, 20]} scaleMs={40} />);
    expect(cy(0)).toBe(axisY());
    expect(cy(1)).toBeLessThan(axisY());
    expect(cy(2)).toBeGreaterThan(axisY());
  });

  it('오차가 클수록 가운데 선에서 더 멀다', () => {
    render(<ErrorChart errors={[0, -10, -30]} scaleMs={40} />);
    expect(axisY() - cy(2)).toBeGreaterThan(axisY() - cy(1));
  });

  it('눈금 끝을 넘는 오차는 그림 가장자리에 붙는다(−scale과 −2×scale의 높이가 같다)', () => {
    render(<ErrorChart errors={[0, -40, -80, 40, 80]} scaleMs={40} />);
    expect(cy(2)).toBe(cy(1));
    expect(cy(4)).toBe(cy(3));
    expect(cy(1)).toBeLessThan(axisY());
    expect(cy(3)).toBeGreaterThan(axisY());
  });

  it('「정박 ±10ms」 띠 이름과 「빠름」·「늦음」 글이 있다', () => {
    const { container } = render(<ErrorChart errors={[0, 3]} scaleMs={40} />);
    expect(container.querySelector('.mini-tempo-chart-band-label')?.textContent).toContain('정박 ±10ms');
    const sides = Array.from(container.querySelectorAll('.mini-tempo-chart-side')).map((el) => el.textContent);
    expect(sides).toEqual(['빠름', '늦음']);
  });

  it('타격 번호가 1부터 n까지 붙는다', () => {
    render(<ErrorChart errors={[0, 1, 2, 3, 4]} scaleMs={40} />);
    const numbers = hits().map((group) => group.querySelector('.mini-tempo-chart-no')?.textContent);
    expect(numbers).toEqual(['1', '2', '3', '4', '5']);
  });

  it('화면 낭독기 목록: 첫 타는 「1번째 기준」, 나머지는 「n번째 오차」', () => {
    const { container } = render(<ErrorChart errors={[0, 8, -3, 0]} scaleMs={40} />);
    const items = Array.from(container.querySelectorAll('.mini-tempo-sr li')).map((li) => li.textContent);
    expect(items).toEqual(['1번째 기준', '2번째 8ms 늦음', '3번째 3ms 빠름', '4번째 정박']);
  });

  it('그림은 낭독기에서 숨긴다(같은 내용은 목록이 읽는다)', () => {
    const { container } = render(<ErrorChart errors={[0, 8]} scaleMs={40} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('오차 목록이 비어 있어도 그리다 멈추지 않는다(타격 없음)', () => {
    const { container } = render(<ErrorChart errors={[]} scaleMs={40} />);
    expect(hits()).toHaveLength(0);
    expect(container.querySelectorAll('.mini-tempo-sr li')).toHaveLength(0);
    expect(container.querySelector('.mini-tempo-chart-axis')).not.toBeNull();
  });

  it('눈금 끝이 0이어도 멈추지 않는다', () => {
    render(<ErrorChart errors={[0, 5, -5]} scaleMs={0} />);
    expect(hits()).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) expect(Number.isFinite(cy(i))).toBe(true);
    expect(cy(1)).toBeGreaterThan(axisY());
    expect(cy(2)).toBeLessThan(axisY());
  });
});

describe('TempoResult', () => {
  const cells = [
    { label: '가장 벗어난 타', value: '16', unit: '번째', note: '32ms 빠름' },
    { label: '끝날 때 빠르기', value: '84.2', unit: 'BPM', note: '제시한 빠르기 80' },
    { label: '흐름', value: '빨라짐', note: '9번째 타격부터' },
  ];

  it('받은 칸 셋과 「타격마다 벗어난 정도」 제목과 그림을 그린다', () => {
    const { container } = render(<TempoResult cells={cells} errors={[0, 6, -4, 6]} scaleMs={40} />);
    const labels = Array.from(container.querySelectorAll('.mini-cell-label')).map((el) => el.textContent);
    expect(labels).toEqual(['가장 벗어난 타', '끝날 때 빠르기', '흐름']);
    expect(container.querySelector('.mini-cells')?.textContent).toContain('84.2');
    expect(container.querySelector('.mini-cells')?.textContent).toContain('9번째 타격부터');
    expect(screen.getByRole('heading', { name: '타격마다 벗어난 정도' })).toBeTruthy();
    expect(container.querySelector('.mini-chart-panel')).not.toBeNull();
    expect(hits()).toHaveLength(4);
  });

  it('제목은 그림 판과 연결돼 있다(aria-labelledby)', () => {
    const { container } = render(<TempoResult cells={cells} errors={[0]} scaleMs={40} />);
    const panel = container.querySelector('.mini-chart-panel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('mini-tempo-chart-title');
    expect(document.getElementById('mini-tempo-chart-title')?.textContent).toBe('타격마다 벗어난 정도');
  });
});
