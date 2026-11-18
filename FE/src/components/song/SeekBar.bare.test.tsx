// @vitest-environment happy-dom
// SeekBar layout="bare" (라이브러리 카드 커버 재생 UI, 설계 CHART-003): 시간 글자 없이 막대만, 끌기·키보드는 그대로.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeekBar } from './SeekBar';

afterEach(cleanup);

describe('SeekBar bare', () => {
  it('is-bare 클래스를 달고 시간 글자(경과·남은 시간)를 그리지 않는다', () => {
    const { container } = render(<SeekBar layout="bare" positionMs={12_000} durationMs={60_000} onSeek={() => {}} />);
    expect(container.querySelector('.free-seek.is-bare')).toBeTruthy();
    expect(container.querySelector('.free-seek-time')).toBeNull();
    expect(container.querySelector('.free-seek-ends')).toBeNull();
    expect(screen.queryByText('0:12')).toBeNull();
  });

  it('시간은 글자 대신 aria-valuetext로 읽힌다', () => {
    render(<SeekBar layout="bare" positionMs={12_000} durationMs={60_000} onSeek={() => {}} />);
    expect(screen.getByRole('slider', { name: '반주 위치' }).getAttribute('aria-valuetext')).toBeTruthy();
  });

  it('키보드는 그대로: →는 5초 앞으로, Home은 처음으로', () => {
    const onSeek = vi.fn();
    render(<SeekBar layout="bare" positionMs={12_000} durationMs={60_000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '반주 위치' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(17_000);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('inline·ends는 그대로 시간 글자를 그린다', () => {
    const inline = render(<SeekBar positionMs={12_000} durationMs={60_000} onSeek={() => {}} />);
    expect(inline.container.querySelector('.free-seek-time')).toBeTruthy();
    cleanup();
    const ends = render(<SeekBar layout="ends" positionMs={12_000} durationMs={60_000} onSeek={() => {}} />);
    expect(ends.container.querySelector('.free-seek-ends')).toBeTruthy();
  });

  it('label을 주면 그 이름으로 읽힌다(녹음 재생바). 없으면 「반주 위치」', () => {
    render(<SeekBar label="녹음 위치" positionMs={12_000} durationMs={60_000} onSeek={() => {}} />);
    expect(screen.getByRole('slider', { name: '녹음 위치' })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: '반주 위치' })).toBeNull();
  });
});
