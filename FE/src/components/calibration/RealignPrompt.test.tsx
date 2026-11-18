// RealignPrompt 표시 검증(PLAY-004 3-9): 손 점 상태, variant 클래스, [건너뛰기] 항상.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RealignPrompt } from './RealignPrompt';

const noop = () => {};

describe('RealignPrompt', () => {
  it('대상이 아닌 손은 off, 기다리는 손은 wait, 끝난 손은 done', () => {
    const html = renderToStaticMarkup(<RealignPrompt hands={[1]} done={[false, false]} onSkip={noop} />);
    expect(html).toContain('realign-hand off');
    expect(html).toContain('realign-hand wait');
    const both = renderToStaticMarkup(<RealignPrompt hands={[0, 1]} done={[true, false]} onSkip={noop} />);
    expect(both).toContain('realign-hand done');
    expect(both).toContain('realign-hand wait');
  });

  it('unstable이면 문구 앞에 「방향이 흔들렸어요.」가 붙는다', () => {
    const html = renderToStaticMarkup(<RealignPrompt hands={[0, 1]} done={[false, false]} unstable onSkip={noop} />);
    expect(html).toContain('방향이 흔들렸어요. 스네어를 왼손·오른손 한 번씩 쳐 주세요');
    const plain = renderToStaticMarkup(<RealignPrompt hands={[0, 1]} done={[false, false]} onSkip={noop} />);
    expect(plain).not.toContain('방향이 흔들렸어요');
  });

  it('variant 클래스와 role=status, [건너뛰기]는 항상', () => {
    for (const v of ['card', 'row', 'band'] as const) {
      const html = renderToStaticMarkup(<RealignPrompt hands={[0]} done={[false, false]} variant={v} onSkip={noop} />);
      expect(html).toContain(`realign-prompt ${v}`);
      expect(html).toContain('role="status"');
      expect(html).toContain('건너뛰기');
    }
  });
});
