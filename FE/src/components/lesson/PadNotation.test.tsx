// @vitest-environment happy-dom
// 레슨 카드 음표: 아래로 뻗는 기둥(킥·플로어탐)이 그 아래 패드 이름 글자를 가리지 않아야 한다(11/12 로컬 확인 발견)
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { notationRows } from '@/domain/play/lesson';
import { staffPosOf } from '@/domain/song/sheet';
import { PadNotation, SoloStaff } from './PadNotation';

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

// 11/13 로컬 확인: 드럼 7개(중급 「8비트에 필인 넣기」)를 한 줄에 두면 카드에 맞추느라 글자가 너무 작아진다 → 4개를 넘으면 줄을 나눈다
describe('PadNotation 줄 나누기', () => {
  it('4개까지는 한 줄, 넘으면 줄 수를 늘려 고르게 나눈다(앞줄이 같거나 많다)', () => {
    const sizes = (n: number) => notationRows(Array.from({ length: n }, (_, i) => i)).map((r) => r.length);
    expect(sizes(1)).toEqual([1]);
    expect(sizes(4)).toEqual([4]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(8)).toEqual([4, 4]);
    expect(sizes(9)).toEqual([3, 3, 3]);
    expect(notationRows(['a', 'b', 'c', 'd', 'e'])).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });

  it('드럼 7개는 오선 두 줄(4개·3개)로 그리고, 읽는 이름은 하나로 모든 드럼을 순서대로 말한다', () => {
    const pads: PadId[] = ['CRASH', 'HIHAT', 'KICK', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM'];
    const { container, getByRole } = render(<PadNotation pads={pads} />);
    const rows = container.querySelectorAll('.lesson-staff svg');
    expect(rows).toHaveLength(2);
    expect([...rows].map((r) => r.querySelectorAll('[data-pad]').length)).toEqual([4, 3]);
    expect(getByRole('img', { name: '악보 위치: 크래시, 하이햇, 킥, 스네어, 스몰탐, 미드탐, 플로어탐' })).toBeTruthy();
  });

  // 11/13 로컬 확인: 두 줄이 되니 카드가 너무 커졌다 → 줄마다 실제 음표가 차지하는 높이만큼만 자리를 잡는다
  it('줄마다 음표 높이만큼만 자리를 잡는다: 아래로 뻗는 기둥이 없으면 이름이 오선에 붙고, 위로 높은 음표가 없으면 위쪽이 줄어든다', () => {
    const row = (pads: PadId[]) => {
      const { container } = render(<PadNotation pads={pads} />);
      const svg = container.querySelector('.lesson-staff svg')!;
      const [, top, , height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      const nameY = Number(container.querySelector('.lesson-staff-name')!.getAttribute('y'));
      cleanup();
      return { top, height, nameY };
    };
    const kick = row(['KICK']);
    const snare = row(['SNARE']);
    const crash = row(['CRASH']);
    const toms = row(['SMALL_TOM', 'MID_TOM']);
    expect(snare.nameY).toBeLessThan(kick.nameY);
    expect(toms.top).toBeGreaterThan(crash.top);
    expect(toms.height).toBeLessThan(crash.height + (kick.nameY - snare.nameY));
  });

  it('4개 이하는 오선 한 줄이다', () => {
    const { container } = render(<PadNotation pads={['HIHAT', 'KICK', 'SNARE']} />);
    expect(container.querySelectorAll('.lesson-staff svg')).toHaveLength(1);
  });
});

// 미니게임 「악보 보고 빨리 치기」의 한 음표 오선
describe('SoloStaff', () => {
  const PADS = ['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'KICK'] as const;

  it('pad가 없으면 오선 다섯 줄과 자리 표시만 그리고 음표는 없다', () => {
    const { container, getByRole } = render(<SoloStaff label="문제 악보" />);
    expect(container.querySelectorAll('.lesson-staff-line')).toHaveLength(5);
    expect(container.querySelector('.lesson-read-cursor')).toBeTruthy();
    expect(container.querySelector('.lesson-note')).toBeNull();
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('문제 악보');
    expect(getByRole('img', { name: '문제 악보' })).toBeTruthy();
  });

  it.each(PADS)('%s: 음표 하나를 머리 모양에 맞게 그린다', (pad) => {
    const { container } = render(<SoloStaff pad={pad} label="이 음표의 패드" />);
    const group = container.querySelector(`[data-pad="${pad}"]`)!;
    expect(group).toBeTruthy();
    expect(container.querySelectorAll('.lesson-note')).toHaveLength(1);
    const note = group.querySelector('.lesson-note')!;
    const { head } = staffPosOf(pad);
    if (head === 'normal') {
      expect(note.querySelector('ellipse')).toBeTruthy();
      expect(note.classList.contains('lesson-note-cross')).toBe(false);
    } else {
      expect(note.classList.contains('lesson-note-cross')).toBe(true);
      expect(note.querySelector('ellipse')).toBeNull();
      expect(note.querySelector('circle') !== null).toBe(head === 'circle-cross');
    }
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('이 음표의 패드');
  });

  it.each(PADS)('%s: 세로 위치가 PadNotation과 같다', (pad) => {
    const ys = (el: Element) => {
      const e = el.querySelector('ellipse');
      if (e) return [e.getAttribute('cy')];
      return [...el.querySelectorAll('line')].map((l) => `${l.getAttribute('y1')},${l.getAttribute('y2')}`);
    };
    const solo = ys(render(<SoloStaff pad={pad} label="x" />).container.querySelector(`[data-pad="${pad}"] .lesson-note`)!);
    cleanup();
    const full = ys(render(<PadNotation pads={[pad]} />).container.querySelector(`[data-pad="${pad}"] .lesson-note`)!);
    expect(solo).toEqual(full);
  });

  it('읽는 이름은 넘긴 문구 그대로이고 패드 이름을 스스로 붙이지 않는다', () => {
    const { container } = render(<SoloStaff pad="SNARE" label="이 음표의 패드" />);
    const label = container.querySelector('svg')!.getAttribute('aria-label')!;
    expect(label).toBe('이 음표의 패드');
    expect(label).not.toContain('스네어');
  });
});
