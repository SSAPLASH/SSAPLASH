// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pagination } from './Pagination';
import { pageGroup } from './paginationGroup';

afterEach(cleanup);

function Harness({ pageCount, initial = 0 }: { pageCount: number; initial?: number }) {
  const [page, setPage] = useState(initial);
  return <Pagination page={page} pageCount={pageCount} onChange={setPage} label="쪽" />;
}

const nums = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => /^\d+$/.test(t));
const current = () => screen.getByRole('button', { current: 'page' }).textContent;
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('pageGroup', () => {
  it('현재 쪽이 속한 10개 묶음, 끝은 전체 쪽 수에서 자른다', () => {
    expect(pageGroup(0, 15)).toEqual([0, 9]);
    expect(pageGroup(9, 15)).toEqual([0, 9]);
    expect(pageGroup(10, 15)).toEqual([10, 14]);
    expect(pageGroup(0, 1)).toEqual([0, 0]);
    expect(pageGroup(19, 20)).toEqual([10, 19]);
  });
});

describe('Pagination (설계 QA-363)', () => {
  it('15쪽이면 1–10만 보이고, 첫 묶음에서 « ‹ 는 비활성', () => {
    render(<Harness pageCount={15} />);
    expect(nums()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(btn('첫 쪽').disabled).toBe(true);
    expect(btn('이전 10쪽').disabled).toBe(true);
    expect(btn('다음 10쪽').disabled).toBe(false);
    expect(btn('마지막 쪽').disabled).toBe(false);
  });

  it('› 는 다음 묶음 첫 쪽, ‹ 는 이전 묶음 마지막 쪽', () => {
    render(<Harness pageCount={15} initial={3} />);
    fireEvent.click(btn('다음 10쪽'));
    expect(current()).toBe('11');
    expect(nums()).toEqual(['11', '12', '13', '14', '15']);
    expect(btn('다음 10쪽').disabled).toBe(true);
    expect(btn('마지막 쪽').disabled).toBe(true);
    fireEvent.click(btn('이전 10쪽'));
    expect(current()).toBe('10');
    expect(nums()[0]).toBe('1');
  });

  it('« » 는 첫 쪽·마지막 쪽', () => {
    render(<Harness pageCount={25} />);
    fireEvent.click(btn('마지막 쪽'));
    expect(current()).toBe('25');
    expect(nums()).toEqual(['21', '22', '23', '24', '25']);
    fireEvent.click(btn('첫 쪽'));
    expect(current()).toBe('1');
  });

  it('10쪽 이하이면 « ‹ › » 모두 비활성, 숫자로 이동', () => {
    render(<Harness pageCount={4} />);
    for (const n of ['첫 쪽', '이전 10쪽', '다음 10쪽', '마지막 쪽']) expect(btn(n).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(current()).toBe('3');
  });

  it('바깥에서 쪽이 바뀌면 그 묶음을 보인다', () => {
    const { rerender } = render(<Pagination page={0} pageCount={30} onChange={() => {}} label="쪽" />);
    rerender(<Pagination page={12} pageCount={30} onChange={() => {}} label="쪽" />);
    expect(nums()[0]).toBe('11');
    expect(screen.getByRole('navigation', { name: '쪽' })).toBeTruthy();
  });
});
