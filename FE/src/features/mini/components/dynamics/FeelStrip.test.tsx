// @vitest-environment happy-dom
// FeelStrip 렌더 검증: 「내 세기」 한 줄의 라벨·항목 글과 값이 없을 때의 빈 렌더.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FeelStrip } from '@/features/mini/components/dynamics/FeelStrip';
import type { FeelShot } from '@/features/mini/domain/dynamicsRound';

afterEach(cleanup);

const FEEL: FeelShot[] = [
  { level: 'weak', actual: 42 },
  { level: 'mid', actual: 78 },
  { level: 'strong', actual: 109 },
];

const items = () => Array.from(document.querySelectorAll('.mini-dyn-feel-item')).map((el) => el.textContent);

describe('FeelStrip', () => {
  it('값이 셋이면 「내 세기」 라벨과 약·중·강 항목이 차례로 나온다', () => {
    render(<FeelStrip feel={FEEL} />);
    expect(screen.getByText('내 세기')).toBeTruthy();
    expect(items()).toEqual(['약 42', '중 78', '강 109']);
  });

  it('비어 있으면 아무것도 그리지 않는다', () => {
    const { container } = render(<FeelStrip feel={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
  });

  it('값이 하나뿐이면 그 항목만 나온다', () => {
    render(<FeelStrip feel={[FEEL[0]]} />);
    expect(screen.getByText('내 세기')).toBeTruthy();
    expect(items()).toEqual(['약 42']);
  });
});
