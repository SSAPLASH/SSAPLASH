import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { staffPosOf } from '@/domain/song/sheet';
import { StaffLegend, type StaffLegendProps } from './StaffLegend';

const ORDER: PadId[] = ['CRASH', 'HIHAT', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'SNARE', 'FLOOR_TOM', 'KICK', 'HIHAT_PEDAL'];

const render = (p: StaffLegendProps = {}) => renderToStaticMarkup(<StaffLegend {...p} />);

describe('StaffLegend', () => {
  const grid = (p: StaffLegendProps = {}) => render(p);
  const cells = (html: string) => html.split('<li ').slice(1, 10);

  it('카드 9칸 + 기호 설명 칸을 그린다', () => {
    const html = grid();
    expect(html.match(/play-sl-cell(?: active)?"/g)).toHaveLength(9);
    expect(html).toContain('play-sl-key');
    cells(html).forEach((c, i) => expect(c).toContain(`play-sl-name">${PAD_META[ORDER[i]].label}`));
  });

  it('발 표시는 킥·하이햇 페달만, 손 표시는 없다', () => {
    const html = grid();
    expect(html.match(/play-sl-tag foot">발/g)).toHaveLength(2);
    expect(html).not.toContain('>손<');
  });

  it('오선 접두를 뺀 짧은 위치 글, 하이햇 페달은 위치 글 생략', () => {
    const c = cells(grid());
    expect(c[ORDER.indexOf('SNARE')]).toContain('play-sl-pos">셋째 칸');
    expect(c[ORDER.indexOf('CRASH')]).toContain('play-sl-pos">오선 위 덧줄');
    expect(c[ORDER.indexOf('HIHAT')]).toContain('play-sl-pos">맨 위 줄 위');
    expect(c[ORDER.indexOf('HIHAT_PEDAL')]).not.toContain('play-sl-pos');
  });

  it('카드마다 패드 색 변수와 aria-label(오선 접두 포함)', () => {
    const c = cells(grid());
    c.forEach((row, i) => expect(row.toLowerCase()).toContain(`--pad-color:${PAD_META[ORDER[i]].color.toLowerCase()}`));
    expect(grid()).toContain('aria-label="스네어 — 오선 셋째 칸, 손"');
  });

  it('오선을 1.4배로 키운다(viewBox 유지)', () => {
    expect(grid()).toContain('width="89.6" height="61.6" viewBox="0 0 64 44"');
  });

  it('activePad·activePads 칸만 active', () => {
    expect(grid({ activePad: 'SNARE' }).match(/play-sl-cell active/g)).toHaveLength(1);
    const html = grid({ activePad: 'KICK', activePads: ['HIHAT', 'KICK'] });
    expect(html.match(/play-sl-cell active/g)).toHaveLength(2);
    expect(grid().match(/play-sl-cell active/g)).toBeNull();
  });

  it('덧줄은 보표 위(pos 10)인 크래시에만, 5선은 칸마다 5개', () => {
    cells(grid()).forEach((c, i) => {
      if (ORDER[i] === 'CRASH') expect(c).toContain('play-sl-ledger');
      else expect(c).not.toContain('play-sl-ledger');
      expect(c.match(/play-sl-line/g)).toHaveLength(5);
    });
  });

  it('기호 y가 staffPosOf 값(선1 y36, 반 칸 3px)과 같다', () => {
    const c = cells(grid());
    ORDER.forEach((pad, i) => {
      const { line, head } = staffPosOf(pad);
      const y = 36 - line * 3;
      if (head === 'normal') expect(c[i]).toContain(`<ellipse class="play-sl-sym fill" cx="32" cy="${y}"`);
      else expect(c[i]).toContain(`y1="${y - 3.5}" x2="35.5" y2="${y + 3.5}"`);
      if (head === 'circle-cross') expect(c[i]).toContain(`<circle cx="32" cy="${y}" r="6"`);
    });
  });

  it('aria-label은 「이름 — 오선 위치, 손/발」 형식, 하이햇은 열린 하이햇 설명 포함', () => {
    const html = grid();
    expect(html).toContain('aria-label="크래시 — 오선 위 덧줄, 손"');
    expect(html).toContain('aria-label="하이햇 — 오선 맨 위 줄 위, 손, o 열린 하이햇, 페달 떼고 치기"');
    expect(html).toContain('aria-label="킥 — 오선 첫째 칸, 발"');
    expect(html).toContain('aria-label="하이햇 페달 — 오선 첫째 줄, 발"');
    expect(html).toContain('aria-label="라이드 — 오선 다섯째 줄, 손"');
    expect(html).toContain('aria-label="악보 읽는 법"');
  });
});
