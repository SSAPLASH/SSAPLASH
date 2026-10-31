import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PAD_META, type PadId } from '@/domain/pads';
import { staffPosOf } from '@/domain/sheet';
import { StaffLegend, type StaffLegendProps } from './StaffLegend';

const ORDER: PadId[] = ['CRASH', 'HIHAT', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'SNARE', 'FLOOR_TOM', 'KICK', 'HIHAT_PEDAL'];

const render = (p: StaffLegendProps = {}) => renderToStaticMarkup(<StaffLegend {...p} />);
/** 줄(li)별 마크업 */
const rows = (html: string) => html.split('<li ').slice(1);

describe('StaffLegend', () => {
  it('9줄을 크래시부터 하이햇 페달까지 위에서 아래 순서로 그린다', () => {
    const r = rows(render());
    expect(r).toHaveLength(9);
    r.forEach((row, i) => expect(row).toContain(`play-sl-name">${PAD_META[ORDER[i]].label}</span>`));
  });

  it('손/발 태그: 킥·하이햇 페달만 발', () => {
    const r = rows(render());
    r.forEach((row, i) => {
      const foot = ORDER[i] === 'KICK' || ORDER[i] === 'HIHAT_PEDAL';
      expect(row).toContain(foot ? 'play-sl-tag foot">발</span>' : 'play-sl-tag">손</span>');
    });
    expect(render().match(/play-sl-tag foot/g)).toHaveLength(2);
  });

  it('aria-label은 「이름 — 오선 위치, 손/발」 형식', () => {
    const html = render();
    expect(html).toContain('aria-label="스네어 — 오선 셋째 칸, 손"');
    expect(html).toContain('aria-label="크래시 — 오선 위 덧줄, 손"');
    expect(html).toContain('aria-label="하이햇 — 오선 맨 위 줄 위, 손"');
    expect(html).toContain('aria-label="킥 — 오선 첫째 칸, 발"');
    expect(html).toContain('aria-label="하이햇 페달 — 오선 첫째 줄, 발"');
    expect(html).toContain('aria-label="라이드 — 오선 다섯째 줄, 손"');
    expect(html).toContain('aria-label="악보 읽는 법"');
  });

  it('패드 색 점이 PAD_META 색', () => {
    const r = rows(render());
    r.forEach((row, i) => expect(row.toLowerCase()).toContain(`background:${PAD_META[ORDER[i]].color.toLowerCase()}`));
  });

  it('activePad 줄만 active 클래스', () => {
    const html = render({ activePad: 'SNARE' });
    expect(html.match(/play-sl-row active/g)).toHaveLength(1);
    expect(rows(html)[ORDER.indexOf('SNARE')]).toContain('play-sl-row active');
    expect(render().match(/play-sl-row active/g)).toBeNull();
  });

  it('기호 y가 staffPosOf 값(선1 y36, 반 칸 3px)과 같다', () => {
    const r = rows(render());
    ORDER.forEach((pad, i) => {
      const { line, head } = staffPosOf(pad);
      const y = 36 - line * 3;
      if (head === 'normal') {
        expect(r[i]).toContain(`<ellipse class="play-sl-sym fill" cx="32" cy="${y}"`);
      } else {
        expect(r[i]).toContain(`y1="${y - 3.5}" x2="35.5" y2="${y + 3.5}"`);
      }
      if (head === 'circle-cross') expect(r[i]).toContain(`<circle cx="32" cy="${y}" r="6"`);
    });
  });

  it('덧줄은 보표 위(pos 10)인 크래시에만 그린다', () => {
    rows(render()).forEach((row, i) => {
      if (ORDER[i] === 'CRASH') expect(row).toContain('play-sl-ledger');
      else expect(row).not.toContain('play-sl-ledger');
    });
  });

  it('5선 줄이 5개씩', () => {
    rows(render()).forEach((row) => expect(row.match(/play-sl-line/g)).toHaveLength(5));
  });
});
