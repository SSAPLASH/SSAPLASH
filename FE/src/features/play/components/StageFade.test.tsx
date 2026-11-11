// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StageFade } from './StageFade';

afterEach(cleanup);

describe('StageFade', () => {
  it('래퍼에 stage-fade 클래스를 달고 자식을 그대로 그린다', () => {
    const { container, getByText } = render(
      <StageFade stageKey="select">
        <main>곡 선택</main>
      </StageFade>,
    );
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toBe('stage-fade');
    expect(wrap.contains(getByText('곡 선택'))).toBe(true);
  });

  it('stageKey가 바뀌면 래퍼를 새로 만들고, 같으면 유지한다', () => {
    const { container, rerender } = render(<StageFade stageKey="select">a</StageFade>);
    const first = container.firstElementChild;
    rerender(<StageFade stageKey="select">b</StageFade>);
    expect(container.firstElementChild).toBe(first);
    rerender(<StageFade stageKey="ready">b</StageFade>);
    expect(container.firstElementChild).not.toBe(first);
    expect(container.firstElementChild?.className).toBe('stage-fade');
  });

  it('instant면 래퍼 없이 자식만 그린다', () => {
    const { container } = render(
      <StageFade stageKey="play" instant>
        <main>연주</main>
      </StageFade>,
    );
    expect(container.querySelector('.stage-fade')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('MAIN');
  });
});
