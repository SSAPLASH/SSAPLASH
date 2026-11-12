// @vitest-environment happy-dom
// 레슨 카드 음표: 아래로 뻗는 기둥(킥·플로어탐)이 그 아래 패드 이름 글자를 가리지 않아야 한다(11/12 로컬 확인 발견)
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PAD_META, type PadId } from '@/domain/pads';
import { PadNotation } from './PadNotation';

/** CSS의 .lesson-staff-name 글자 크기(px, SVG 좌표 단위) */
const NAME_FONT = 13;
/** 음표 맨 아래와 글자 윗부분 사이에 둘 최소 여백 */
const MIN_GAP = 4;

afterEach(cleanup);

function lowestNoteY(group: Element): number {
  const ys: number[] = [];
  group.querySelectorAll('.lesson-note line').forEach((l) => ys.push(Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))));
  group.querySelectorAll('.lesson-note ellipse').forEach((e) => ys.push(Number(e.getAttribute('cy')) + Number(e.getAttribute('ry'))));
  group.querySelectorAll('.lesson-note circle').forEach((c) => ys.push(Number(c.getAttribute('cy')) + Number(c.getAttribute('r'))));
  return Math.max(...ys);
}

describe('PadNotation 글자 자리', () => {
  it.each(Object.keys(PAD_META) as PadId[])('%s: 음표(기둥 포함) 아래에 이름 글자가 겹치지 않게 놓인다', (pad) => {
    const { container } = render(<PadNotation pads={[pad]} />);
    const group = container.querySelector(`[data-pad="${pad}"]`)!;
    const name = group.querySelector('.lesson-staff-name')!;
    const nameTop = Number(name.getAttribute('y')) - NAME_FONT;
    expect(nameTop).toBeGreaterThanOrEqual(lowestNoteY(group) + MIN_GAP);
  });
});
