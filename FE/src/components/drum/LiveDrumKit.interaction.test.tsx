// @vitest-environment happy-dom
// LiveDrumKit: 하이햇 페달 훅 값을 DrumKit에 넘긴다(열림·닫힘·페달 없음·페달 타격 모션).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { initialPedal, useLive } from '@/store/liveStore';
import { LiveDrumKit } from './LiveDrumKit';

function setPedal(connected: boolean, hihatClosed: boolean) {
  useLive.setState({ pedal: { ...initialPedal(), connected: [connected, false], hihatClosed } });
}

function fire(pad: PadId) {
  const hit = { id: 1, pad } as ResolvedHit;
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

describe('LiveDrumKit', () => {
  afterEach(() => {
    cleanup();
    useLive.setState({ pedal: initialPedal(), lastHit: null, hitSeq: 0 });
  });

  it('페달 연결·열림이면 하이햇이 열린다', () => {
    setPedal(true, false);
    const { container } = render(<LiveDrumKit />);
    expect(container.querySelector('[data-closed]')).toBeNull();
    expect(container.querySelector('[data-off]')).toBeNull();
    expect(container.querySelector('[data-pressed]')).toBeNull();
  });

  it('밟으면 닫히고 페달이 눌린다, 떼면 다시 열린다', () => {
    setPedal(true, true);
    const { container } = render(<LiveDrumKit />);
    expect(container.querySelectorAll('[data-closed]').length).toBe(1);
    expect(container.querySelector('[data-pressed]')).not.toBeNull();
    act(() => setPedal(true, false));
    expect(container.querySelector('[data-closed]')).toBeNull();
  });

  it('페달이 없으면 닫힌 채 페달이 어둡다', () => {
    setPedal(false, false);
    const { container } = render(<LiveDrumKit />);
    expect(container.querySelectorAll('[data-closed]').length).toBe(1);
    expect(container.querySelector('[data-off]')).not.toBeNull();
    expect(container.querySelector('[data-pressed]')).toBeNull();
  });

  it('페달 타격에만 칙 모션이 켜지고 다른 패드 타격에는 켜지지 않는다', () => {
    setPedal(true, true);
    const { container } = render(<LiveDrumKit />);
    expect(container.querySelector('[data-pulse]')).toBeNull();
    act(() => fire('SNARE'));
    expect(container.querySelector('[data-pulse]')).toBeNull();
    act(() => fire('HIHAT_PEDAL'));
    expect(container.querySelectorAll('[data-pulse]').length).toBe(2);
  });

  it('props는 DrumKit으로 그대로 전달된다', () => {
    setPedal(true, true);
    const { container } = render(<LiveDrumKit skin="electronic" />);
    expect(container.querySelector('svg')?.getAttribute('data-skin')).toBe('electronic');
    expect(container.querySelector('[data-closed]')).toBeNull();
  });
});
