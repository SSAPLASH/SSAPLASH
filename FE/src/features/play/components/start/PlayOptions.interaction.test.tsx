// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordingStore } from '@/runtime/recordingStore';
import type { AccompanimentStatus } from '@/domain/song/songCatalog';
import { PlayOptions } from './PlayOptions';

vi.mock('@/runtime/sources', () => ({ inputManager: { onHit: () => () => {} } }));

function renderOptions(hasAccompaniment: boolean, accompanimentStatus?: AccompanimentStatus | null, extra: Partial<Parameters<typeof PlayOptions>[0]> = {}) {
  return render(<PlayOptions hasAccompaniment={hasAccompaniment} accompanimentStatus={accompanimentStatus} {...extra} />);
}
const sw = (name: string) => screen.getByRole('switch', { name }) as HTMLButtonElement;

beforeEach(() => useRecordingStore.setState({ phase: 'idle', locked: false }));
afterEach(cleanup);

describe('PlayOptions 줄', () => {
  it('기본은 스위치 네 줄(메트로놈·패드 박 번호·반주·녹음)', () => {
    renderOptions(true, 'READY');
    expect(screen.getAllByRole('switch').map((b) => b.getAttribute('aria-label'))).toEqual(['메트로놈', '패드 박 번호', '반주', '이번 연주 녹음']);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('rows로 보일 줄만 낸다', () => {
    renderOptions(true, 'READY', { rows: ['metronome', 'recording'] });
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByRole('switch', { name: '반주' })).toBeNull();
  });

  it('메트로놈·패드 번호·반주 스위치는 콜백으로 간다', async () => {
    const onMetronome = vi.fn();
    const onPadCount = vi.fn();
    const onAccompaniment = vi.fn();
    renderOptions(true, 'READY', { onMetronome, onPadCount, onAccompaniment, accompaniment: true });
    const user = userEvent.setup();
    await user.click(sw('메트로놈'));
    await user.click(sw('패드 박 번호'));
    await user.click(sw('반주'));
    expect(onMetronome).toHaveBeenCalledWith(true);
    expect(onPadCount).toHaveBeenCalledWith(true);
    expect(onAccompaniment).toHaveBeenCalledWith(false);
  });

  it('줄의 글자를 눌러도 그 줄의 스위치가 바뀐다(한 번만)', async () => {
    const onPadCount = vi.fn();
    renderOptions(true, 'READY', { onPadCount, padCount: true });
    await userEvent.setup().click(screen.getByText('드럼 패드 위에 다음에 칠 박을 보여요'));
    expect(onPadCount).toHaveBeenCalledTimes(1);
    expect(onPadCount).toHaveBeenCalledWith(false);
  });
});

describe('PlayOptions 박 분할', () => {
  it('onSubdivision이 없으면 선택 칸을 내지 않는다', () => {
    renderOptions(true, 'READY', { metronome: true });
    expect(screen.queryByRole('radiogroup', { name: '박 분할' })).toBeNull();
  });

  it('메트로놈이 켜져 있으면 펼쳐지고 곡 BPM으로 푼 문구를 보인다', () => {
    renderOptions(true, 'READY', { metronome: true, subdivision: 'auto', onSubdivision: vi.fn(), songBpm: 72 });
    const sub = document.querySelector('.play-opt-sub')!;
    expect(sub.className).toContain('open');
    expect(sub.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('radio', { name: '자동' }).getAttribute('aria-checked')).toBe('true');
    expect(sub.textContent).toContain('BPM 72 곡이라 8분음표로 울려요');
  });

  it('메트로놈이 꺼져 있으면 접히고 초점이 가지 않는다', () => {
    renderOptions(true, 'READY', { metronome: false, onSubdivision: vi.fn(), songBpm: 72 });
    const sub = document.querySelector('.play-opt-sub')!;
    expect(sub.className).not.toContain('open');
    expect(sub.hasAttribute('inert')).toBe(true);
  });

  it('고르면 onSubdivision으로 간다', async () => {
    const onSubdivision = vi.fn();
    renderOptions(true, 'READY', { metronome: true, subdivision: 'auto', onSubdivision, songBpm: 128 });
    await userEvent.setup().click(screen.getByRole('radio', { name: '8분음표' }));
    expect(onSubdivision).toHaveBeenCalledWith('eighth');
  });
});

describe('PlayOptions 연습 속도 (MODE-003)', () => {
  const rateSub = () => document.querySelector('.play-opt-rate')!.closest('.play-opt-sub')!;

  it('onRate가 없으면 속도 줄을 내지 않는다', () => {
    renderOptions(true, 'READY', { accompaniment: false });
    expect(screen.queryByRole('group', { name: '연습 속도' })).toBeNull();
  });

  it('반주가 켜져 있으면 접혀 있고 반주 줄에 안내가 붙는다', () => {
    renderOptions(true, 'READY', { accompaniment: true, onRate: vi.fn() });
    expect(rateSub().className).not.toContain('open');
    expect(rateSub().hasAttribute('inert')).toBe(true);
    expect(screen.getByText('끄면 연습 속도를 고를 수 있어요')).toBeTruthy();
  });

  it('반주를 끄거나 반주가 없는 곡이면 펼쳐지고 배율과 실제 BPM을 보인다', () => {
    const { unmount } = renderOptions(true, 'READY', { accompaniment: false, onRate: vi.fn(), rate: 0.7, sourceBpm: 120 });
    expect(rateSub().className).toContain('open');
    expect(rateSub().textContent).toContain('70%');
    expect(rateSub().textContent).toContain('BPM 120 → 84');
    unmount();
    renderOptions(false, 'NONE', { accompaniment: true, onRate: vi.fn(), rate: 1, sourceBpm: 120 });
    expect(rateSub().className).toContain('open');
    expect(rateSub().textContent).toContain('원래 빠르기');
  });

  it('−/+는 5 % 단위이고 50 %·100 %에서 그쪽 버튼이 비활성이다', async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderOptions(true, 'READY', { accompaniment: false, onRate, rate: 0.7, sourceBpm: 120 });
    await user.click(screen.getByRole('button', { name: '5% 느리게' }));
    await user.click(screen.getByRole('button', { name: '5% 빠르게' }));
    expect(onRate.mock.calls.map((c) => c[0])).toEqual([0.65, 0.75]);
    unmount();
    const low = renderOptions(true, 'READY', { accompaniment: false, onRate, rate: 0.5 });
    expect((screen.getByRole('button', { name: '5% 느리게' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '5% 빠르게' }) as HTMLButtonElement).disabled).toBe(false);
    low.unmount();
    renderOptions(true, 'READY', { accompaniment: false, onRate, rate: 1 });
    expect((screen.getByRole('button', { name: '5% 빠르게' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PlayOptions 반주 줄', () => {
  it('반주가 있으면 활성이고 설정을 따른다', () => {
    renderOptions(true, 'READY', { accompaniment: false });
    expect(sw('반주').disabled).toBe(false);
    expect(sw('반주').getAttribute('aria-checked')).toBe('false');
  });

  it('반주가 없으면 생성 중은 「반주 생성 중」, 실패·대상 아님·모름은 「반주 없음」 + 비활성', () => {
    const { unmount } = renderOptions(false, 'GENERATING');
    expect(sw('반주 (반주 생성 중)').disabled).toBe(true);
    expect(sw('반주 (반주 생성 중)').getAttribute('aria-checked')).toBe('false');
    unmount();
    for (const s of ['FAILED', 'NONE', null, 'READY'] as const) {
      const r = renderOptions(false, s);
      expect(sw('반주 (반주 없음)').disabled).toBe(true);
      r.unmount();
    }
  });
});

describe('PlayOptions 녹음 줄', () => {
  it('토글하면 녹음 스토어가 idle ↔ armed로 바뀐다', async () => {
    renderOptions(true, 'READY');
    const user = userEvent.setup();
    await user.click(sw('이번 연주 녹음'));
    expect(useRecordingStore.getState().phase).toBe('armed');
    await user.click(sw('이번 연주 녹음'));
    expect(useRecordingStore.getState().phase).toBe('idle');
  });

  it('잠겨 있으면 비활성이다', () => {
    useRecordingStore.setState({ phase: 'armed', locked: true });
    renderOptions(true, 'READY');
    expect(sw('이번 연주 녹음').disabled).toBe(true);
  });
});
