// @vitest-environment happy-dom
// MiniCard 검증: 최고 기록 표시 형식, 갈래 꼬리말, 기록 없음 문구, [시작] 콜백.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniCard } from '@/features/mini/components/MiniCard';
import type { MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { MiniRecord } from '@/features/mini/domain/miniRecord';

afterEach(cleanup);

const INFO: MiniGameInfo = { id: 'speed', name: '누구보다 빠르게', rule: '10초 동안 스네어 가장 많이 치기', tag: '10초', unit: '타', better: 'higher' };

function record(score: number): MiniRecord {
  return { gameId: 'speed', score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
}

function value(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.mini-card-value');
}

describe('MiniCard 최고 기록 표시', () => {
  it('표시 형식이 없으면 숫자 그대로 보이고 단위가 붙는다', () => {
    const { container } = render(<MiniCard info={INFO} record={record(68)} art={null} onStart={() => undefined} />);
    expect(value(container)?.textContent).toBe('68타');
    expect(screen.queryByText('아직 기록이 없어요')).toBeNull();
  });

  it('표시 형식이 있으면 그 형식으로 보인다(420 → 0.42)', () => {
    const info: MiniGameInfo = { ...INFO, unit: '초', better: 'lower', format: (ms) => (ms / 1000).toFixed(2) };
    const { container } = render(<MiniCard info={info} record={record(420)} art={null} onStart={() => undefined} />);
    expect(value(container)?.textContent).toBe('0.42초');
    expect(screen.queryByText('420')).toBeNull();
  });

  it('variantName을 넘기면 값 뒤에 갈래 이름이 붙는다', () => {
    const { container } = render(<MiniCard info={INFO} record={record(68)} variantName="힌트 끔" art={null} onStart={() => undefined} />);
    expect(value(container)?.textContent).toBe('68타힌트 끔');
    expect(container.querySelector('.mini-card-variant')?.textContent).toBe('힌트 끔');
  });

  it('variantName을 넘기지 않으면 갈래 이름이 없다', () => {
    const { container } = render(<MiniCard info={INFO} record={record(68)} art={null} onStart={() => undefined} />);
    expect(container.querySelector('.mini-card-variant')).toBeNull();
  });

  it('기록이 없으면 「아직 기록이 없어요」만 보이고 값은 없다', () => {
    const { container } = render(<MiniCard info={INFO} record={null} art={null} onStart={() => undefined} />);
    expect(screen.getByText('아직 기록이 없어요')).toBeTruthy();
    expect(value(container)).toBeNull();
  });

  it('기록이 없을 때는 variantName을 넘겨도 갈래 이름이 없다', () => {
    const { container } = render(<MiniCard info={INFO} record={null} variantName="힌트 끔" art={null} onStart={() => undefined} />);
    expect(container.querySelector('.mini-card-variant')).toBeNull();
  });
});

describe('MiniCard 구성', () => {
  it('이름·규칙·꼬리표·그림이 보이고 [시작]을 누르면 onStart가 불린다', () => {
    const onStart = vi.fn();
    render(<MiniCard info={INFO} record={null} art={<span data-testid="art" />} onStart={onStart} />);
    expect(screen.getByRole('heading', { name: '누구보다 빠르게' })).toBeTruthy();
    expect(screen.getByText('10초 동안 스네어 가장 많이 치기')).toBeTruthy();
    expect(screen.getByText('10초')).toBeTruthy();
    expect(screen.getByTestId('art')).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '누구보다 빠르게 시작' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
