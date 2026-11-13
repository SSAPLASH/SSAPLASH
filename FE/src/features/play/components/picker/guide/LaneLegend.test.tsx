import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HIGHWAY_LANES } from '@/features/play/domain/highwayLanes';
import { PAD_META } from '@/domain/kit/pads';
import { LaneLegend, type LaneLegendProps } from './LaneLegend';

const render = (p: LaneLegendProps = {}) => renderToStaticMarkup(<LaneLegend {...p} />);
const cells = (html: string) => html.split('<li ').slice(1, 10);

describe('LaneLegend', () => {
  it('제목·설명·아래 안내 한 줄', () => {
    const html = render();
    expect(html).toContain('aria-label="레인 읽는 법"');
    expect(html).toContain('>레인 읽는 법<');
    expect(html).toContain('노트가 떨어지는 레인이 칠 패드예요. 레인은 드럼이 놓인 순서대로 왼쪽부터 있어요.');
    expect(html).toContain('칸에 마우스를 올리면 왼쪽 장면의 같은 레인과 패드가 빛나요.');
  });

  it('악보 읽는 법과 같은 2열 카드 클래스를 쓴다', () => {
    const html = render({ className: 'extra' });
    expect(html).toContain('class="play-sl grid extra"');
    expect(html).toContain('play-sl-cells');
  });

  it('레인 순서대로 9칸 + 색 설명 칸', () => {
    const html = render();
    expect(html.match(/play-sl-cell(?: active)?"/g)).toHaveLength(9);
    expect(html).toContain('play-sl-key');
    cells(html).forEach((c, i) => expect(c).toContain(`play-sl-name">${PAD_META[HIGHWAY_LANES[i]].label}`));
  });

  it('이름 옆 글은 레인 위치(맨 왼쪽·1번째…8번째)', () => {
    const c = cells(render());
    expect(c[0]).toContain('play-sl-pos">맨 왼쪽');
    expect(c[1]).toContain('play-sl-pos">1번째');
    expect(c[8]).toContain('play-sl-pos">8번째');
  });

  it('발 표시는 하이햇 페달·킥만', () => {
    const html = render();
    expect(html.match(/play-sl-tag foot">발/g)).toHaveLength(2);
    const c = cells(html);
    expect(c[0]).toContain('play-sl-tag foot');
    expect(c[HIGHWAY_LANES.indexOf('KICK')]).toContain('play-sl-tag foot');
    expect(c[HIGHWAY_LANES.indexOf('SNARE')]).not.toContain('play-sl-tag foot');
  });

  it('aria-label은 레인 위치와 손·발을 말한다', () => {
    const html = render();
    expect(html).toContain('aria-label="하이햇 페달 — 맨 왼쪽 따로 떨어진 레인, 발"');
    expect(html).toContain('aria-label="하이햇 — 왼쪽에서 1번째 레인, 손"');
    expect(html).toContain('aria-label="킥 — 왼쪽에서 5번째 레인, 발"');
    expect(html).toContain('aria-label="색 설명"');
  });

  it('칸마다 네온 3색 변수(심벌 골드·북 시안·킥 마젠타)', () => {
    const c = cells(render()).map((row) => row.toLowerCase());
    const color = (pad: string) => c[HIGHWAY_LANES.indexOf(pad as never)];
    expect(color('HIHAT_PEDAL')).toContain('--pad-color:#ffc24a');
    expect(color('CRASH')).toContain('--pad-color:#ffc24a');
    expect(color('SMALL_TOM')).toContain('--pad-color:#22e4ff');
    expect(color('FLOOR_TOM')).toContain('--pad-color:#22e4ff');
    expect(color('KICK')).toContain('--pad-color:#ff3ec8');
  });

  it('미니 레인 띠: 9칸 중 이 레인만 on, 페달 칸은 떼어 둔다', () => {
    const c = cells(render());
    c.forEach((row, i) => {
      expect(row.match(/class="on"/g)).toHaveLength(1);
      expect(row.match(/class="off"/g)).toHaveLength(8);
      const bars = [...row.matchAll(/<rect class="(on|off)" x="([\d.]+)"/g)];
      expect(bars[i][1]).toBe('on');
    });
    // 페달 칸(x=1)과 둘째 칸(x=10) 사이는 띄워져 있고, 둘째 칸부터는 이어 붙은 간격이다
    const xs = [...c[0].matchAll(/<rect class="(?:on|off)" x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs[0]).toBe(1);
    expect(xs[1]).toBe(10);
    expect(xs[2] - xs[1]).toBeCloseTo(6.7, 5);
  });

  it('activePads에 든 칸만 active', () => {
    const html = render({ activePads: ['CRASH', 'KICK'] });
    const active = cells(html).filter((c) => c.includes('play-sl-cell active"'));
    expect(active).toHaveLength(2);
    expect(active[0]).toContain('play-sl-name">크래시');
    expect(active[1]).toContain('play-sl-name">킥');
    expect(render()).not.toContain('play-sl-cell active');
  });
});
