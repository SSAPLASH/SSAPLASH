// @vitest-environment happy-dom
// OneShotResult·ShotChart 검증: 정답 자리와 내 타격 그림(점 자리·색·라벨)과 곡별 기록 줄.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShotOutcome } from '@/features/mini/domain/oneShotRound';
import { OneShotResult } from './OneShotResult';
import { ShotChart } from './ShotChart';

afterEach(cleanup);

const MINUS = '−';
const hitGroup = () => screen.queryByTestId('mini-oneshot-hit');
const dot = () => hitGroup()?.querySelector('circle') ?? null;
const dotX = () => Number(dot()?.getAttribute('cx'));
const band = () => screen.getByTestId('mini-oneshot-band');
const bandX = () => Number(band().getAttribute('x'));
const bandWidth = () => Number(band().getAttribute('width'));
const sr = () => document.querySelector('.mini-oneshot-sr')?.textContent ?? null;
const chorus = () => document.querySelector('.mini-oneshot-chart-chorus');
const svgTexts = () => Array.from(document.querySelectorAll('svg text')).map((el) => el.textContent);

function chart(outcome: ShotOutcome) {
  return render(<ShotChart outcome={outcome} />);
}

describe('ShotChart', () => {
  it('성공 +38: 맞은 점 그룹은 is-good, data-offset 38, 라벨 「내 타격 +38ms」', () => {
    chart({ kind: 'success', errorMs: 38 });
    expect(hitGroup()?.classList.contains('is-good')).toBe(true);
    expect(hitGroup()?.getAttribute('data-offset')).toBe('38');
    expect(svgTexts()).toContain('내 타격 +38ms');
  });

  it('범위 밖 −300: is-bad, 점은 ±250으로 잘려 data-offset이 −250이고 자리는 −250과 같다', () => {
    const { unmount } = chart({ kind: 'miss', errorMs: -300 });
    expect(hitGroup()?.classList.contains('is-bad')).toBe(true);
    expect(hitGroup()?.getAttribute('data-offset')).toBe('-250');
    // 라벨은 잘리지 않은 실제 오차를 말한다
    expect(svgTexts()).toContain(`내 타격 ${MINUS}300ms`);
    const clampedX = dotX();
    unmount();
    chart({ kind: 'miss', errorMs: -250 });
    expect(dotX()).toBe(clampedX);
  });

  it('범위 밖 +300은 오른쪽 한도(+250)에 놓인다', () => {
    chart({ kind: 'miss', errorMs: 300 });
    expect(hitGroup()?.getAttribute('data-offset')).toBe('250');
  });

  it('정적 전에 침·치지 않음: 맞은 점 그룹이 없다', () => {
    const { unmount } = chart({ kind: 'before' });
    expect(hitGroup()).toBeNull();
    unmount();
    chart({ kind: 'none' });
    expect(hitGroup()).toBeNull();
  });

  it('허용 범위 라벨(「허용 범위 ±80ms」)과 「정답」 라벨이 있다', () => {
    chart({ kind: 'none' });
    expect(svgTexts()).toContain('허용 범위 ±80ms');
    expect(svgTexts()).toContain('정답');
    expect(svgTexts()).toContain('정적');
  });

  it('후렴 막대는 성공일 때만 켜지고 그 밖에는 is-dim이다', () => {
    const kinds: { outcome: ShotOutcome; dim: boolean }[] = [
      { outcome: { kind: 'success', errorMs: 0 }, dim: false },
      { outcome: { kind: 'miss', errorMs: 120 }, dim: true },
      { outcome: { kind: 'before' }, dim: true },
      { outcome: { kind: 'none' }, dim: true },
    ];
    for (const { outcome, dim } of kinds) {
      const { unmount } = chart(outcome);
      expect(chorus()?.classList.contains('is-dim')).toBe(dim);
      unmount();
    }
  });

  it('+80의 점은 허용 범위 띠의 오른쪽 가장자리에, −80의 점은 왼쪽 가장자리에 놓인다', () => {
    const { unmount } = chart({ kind: 'success', errorMs: 80 });
    expect(dotX()).toBeCloseTo(bandX() + bandWidth(), 6);
    unmount();
    chart({ kind: 'success', errorMs: -80 });
    expect(dotX()).toBeCloseTo(bandX(), 6);
  });

  it('오차 0의 점은 띠의 가운데(정답 선)에 놓인다', () => {
    chart({ kind: 'success', errorMs: 0 });
    expect(dotX()).toBeCloseTo(bandX() + bandWidth() / 2, 6);
    expect(svgTexts()).toContain('내 타격 0ms');
  });

  it('그림은 장식이고 같은 내용을 낭독용 문장으로 따로 둔다', () => {
    const { container } = chart({ kind: 'success', errorMs: 38 });
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(sr()).toBe('내 타격은 정답보다 38ms 늦음');
  });

  it('낭독 문장: 빠름·정확·재지 못함', () => {
    const { unmount } = chart({ kind: 'miss', errorMs: -61 });
    expect(sr()).toBe('내 타격은 정답보다 61ms 빠름');
    unmount();
    const second = chart({ kind: 'success', errorMs: 0 });
    expect(sr()).toBe('내 타격은 정답과 같아요');
    second.unmount();
    const third = chart({ kind: 'before' });
    expect(sr()).toBe('타격 위치를 재지 못했어요');
    third.unmount();
    chart({ kind: 'none' });
    expect(sr()).toBe('타격 위치를 재지 못했어요');
  });
});

describe('OneShotResult', () => {
  const ROWS = [{ id: 'iwaly', name: 'I Will Always Love You', when: '방금', text: '38ms 늦음' }];

  it('두 판의 제목(정답 자리와 내 타격 · 곡별 기록)이 있다', () => {
    render(<OneShotResult outcome={{ kind: 'success', errorMs: 38 }} rows={ROWS} />);
    expect(screen.getByRole('heading', { name: '정답 자리와 내 타격' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '곡별 기록' })).toBeTruthy();
    expect(screen.getByTestId('mini-oneshot-band')).toBeTruthy();
  });

  it('두 판은 제목으로 이름 붙은 영역이다', () => {
    render(<OneShotResult outcome={{ kind: 'none' }} rows={ROWS} />);
    expect(screen.getByRole('region', { name: '정답 자리와 내 타격' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '곡별 기록' })).toBeTruthy();
  });

  it('기록 줄: 곡 이름·때 글·값이 보인다', () => {
    render(<OneShotResult outcome={{ kind: 'success', errorMs: 38 }} rows={ROWS} />);
    const row = screen.getByTestId('mini-oneshot-row-iwaly');
    expect(row.querySelector('.mini-oneshot-record-name')?.textContent).toBe('I Will Always Love You');
    expect(row.querySelector('.mini-oneshot-record-when')?.textContent).toBe('방금');
    expect(row.querySelector('.mini-oneshot-record-value')?.textContent).toBe('38ms 늦음');
    expect(row.querySelector('.is-empty')).toBeNull();
  });

  it('기록이 없는 줄(text: null)은 「기록 없음」(is-empty)이고 때 글이 없다', () => {
    render(
      <OneShotResult
        outcome={{ kind: 'none' }}
        rows={[{ id: 'iwaly', name: 'I Will Always Love You', when: '방금', text: null }]}
      />,
    );
    const row = screen.getByTestId('mini-oneshot-row-iwaly');
    expect(row.querySelector('.mini-oneshot-record-value')?.textContent).toBe('기록 없음');
    expect(row.querySelector('.mini-oneshot-record-value')?.classList.contains('is-empty')).toBe(true);
    expect(row.querySelector('.mini-oneshot-record-when')).toBeNull();
  });

  it('곡이 여럿이면 줄이 곡마다 하나씩 순서대로 나온다', () => {
    render(
      <OneShotResult
        outcome={{ kind: 'none' }}
        rows={[
          { id: 'a', name: '가', when: '오늘', text: '10ms 정박' },
          { id: 'b', name: '나', when: '', text: null },
        ]}
      />,
    );
    const names = Array.from(document.querySelectorAll('.mini-oneshot-record-name')).map((el) => el.textContent);
    expect(names).toEqual(['가', '나']);
    expect(screen.getByTestId('mini-oneshot-row-a')).toBeTruthy();
    expect(screen.getByTestId('mini-oneshot-row-b')).toBeTruthy();
  });
});
