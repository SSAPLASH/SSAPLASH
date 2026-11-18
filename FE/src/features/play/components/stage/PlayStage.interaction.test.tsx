// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PlayStage } from './PlayStage';

afterEach(cleanup);
const slots = { hud: <i />, area: <i />, guide: <i />, kit: <i />, readout: <i /> };

describe('PlayStage 킷 칸 크기(설계 MODE-003-practice-speed D18)', () => {
  it('kitSize를 주면 킷 칸 크기를 CSS 변수로 넘긴다(악보 연습)', () => {
    const { container } = render(<PlayStage variant="sheet" {...slots} kitSize={{ width: 431, height: 369 }} />);
    const stage = container.querySelector<HTMLElement>('.play-stage.sheet')!;
    expect(stage.style.getPropertyValue('--kit-w')).toBe('431px');
    expect(stage.style.getPropertyValue('--kit-h')).toBe('369px');
  });

  it('kitSize가 없으면 변수를 두지 않는다(리듬 게임은 CSS의 고정 크기)', () => {
    const { container } = render(<PlayStage variant="game" {...slots} />);
    const stage = container.querySelector<HTMLElement>('.play-stage.game')!;
    expect(stage.style.getPropertyValue('--kit-w')).toBe('');
    expect(stage.getAttribute('style')).toBeNull();
  });
});
