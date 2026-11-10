// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordingStore } from '@/app/recordingStore';
import type { AccompanimentStatus } from '@/domain/songCatalog';
import { PlayOptions } from './PlayOptions';

vi.mock('@/app/sources', () => ({ inputManager: { onHit: () => () => {} } }));

function renderOptions(hasAccompaniment: boolean, accompanimentStatus?: AccompanimentStatus | null, extra: Partial<Parameters<typeof PlayOptions>[0]> = {}) {
  return render(<PlayOptions hasAccompaniment={hasAccompaniment} accompanimentStatus={accompanimentStatus} {...extra} />);
}

beforeEach(() => useRecordingStore.setState({ phase: 'idle', locked: false }));
afterEach(cleanup);

describe('PlayOptions 줄', () => {
  it('기본은 네 줄(메트로놈·패드 번호·반주·녹음)', () => {
    renderOptions(true, 'READY');
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });

  it('rows로 보일 줄만 낸다', () => {
    renderOptions(true, 'READY', { rows: ['metronome', 'recording'] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByLabelText(/반주 재생/)).toBeNull();
  });

  it('메트로놈·패드 번호·반주 토글은 콜백으로 간다', async () => {
    const onMetronome = vi.fn();
    const onPadCount = vi.fn();
    const onAccompaniment = vi.fn();
    renderOptions(true, 'READY', { onMetronome, onPadCount, onAccompaniment, accompaniment: true });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('메트로놈 클릭을 곡 중에도 낸다'));
    await user.click(screen.getByLabelText('드럼 패드 위에 다음 칠 박 번호를 보인다'));
    await user.click(screen.getByLabelText('반주 재생'));
    expect(onMetronome).toHaveBeenCalledWith(true);
    expect(onPadCount).toHaveBeenCalledWith(true);
    expect(onAccompaniment).toHaveBeenCalledWith(false);
  });
});

describe('PlayOptions 반주 줄', () => {
  it('반주가 있으면 활성이고 설정을 따른다', () => {
    renderOptions(true, 'READY', { accompaniment: false });
    const box = screen.getByLabelText('반주 재생') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
  });

  it('반주가 없으면 생성 중은 「반주 생성 중」, 실패·대상 아님·모름은 「반주 없음」 + 비활성', () => {
    const { unmount } = renderOptions(false, 'GENERATING');
    expect((screen.getByLabelText('반주 재생 (반주 생성 중)') as HTMLInputElement).disabled).toBe(true);
    unmount();
    for (const s of ['FAILED', 'NONE', null, 'READY'] as const) {
      const r = renderOptions(false, s);
      expect(screen.getByLabelText('반주 재생 (반주 없음)')).toBeTruthy();
      r.unmount();
    }
  });
});

describe('PlayOptions 녹음 줄', () => {
  it('토글하면 녹음 스토어가 idle ↔ armed로 바뀐다', async () => {
    renderOptions(true, 'READY');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('이번 연주를 녹음한다'));
    expect(useRecordingStore.getState().phase).toBe('armed');
    await user.click(screen.getByLabelText('이번 연주를 녹음한다'));
    expect(useRecordingStore.getState().phase).toBe('idle');
  });

  it('잠겨 있으면 비활성이다', () => {
    useRecordingStore.setState({ phase: 'armed', locked: true });
    renderOptions(true, 'READY');
    expect((screen.getByLabelText('이번 연주를 녹음한다') as HTMLInputElement).disabled).toBe(true);
  });
});
