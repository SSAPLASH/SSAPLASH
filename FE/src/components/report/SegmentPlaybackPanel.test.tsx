// 구간 재생 패널 렌더 (COACH-003 설계 4장).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WeakSegment } from '@/domain/report';
import { SegmentPlaybackPanel, type SegmentPlaybackPanelProps } from './SegmentPlaybackPanel';

const SEG: WeakSegment = {
  fromMs: 7000,
  toMs: 12000,
  pattern: 'MISS_CLUSTER',
  description: '설명',
  causeTags: [],
  pads: ['SNARE'],
  severity: 0.5,
  scope: 'SEGMENT',
  metrics: {},
};

function render(over: Partial<SegmentPlaybackPanelProps> = {}): string {
  return renderToStaticMarkup(
    <SegmentPlaybackPanel
      seg={SEG}
      rangeText="4~6마디 · 0:07 – 0:12"
      position={{ from: 0.25, to: 0.5 }}
      playing={false}
      rate={1}
      loop={false}
      disabled={false}
      onPlay={() => {}}
      onStop={() => {}}
      onToggleRate={() => {}}
      onToggleLoop={() => {}}
      {...over}
    />,
  );
}

describe('SegmentPlaybackPanel', () => {
  it('제목·구간 문구·막대·캡션', () => {
    const h = render();
    expect(h).toContain('구간 재생</strong>');
    expect(h).toContain('4~6마디 · 0:07 – 0:12');
    expect(h).toContain('left:25%;width:25%');
    expect(h).toContain('FE 드럼 소리로 재연한 정답 연주예요');
    expect(h).toContain('느리게 0.75×');
    expect(h).toContain('반복');
  });
  it('WHOLE은 전체 재생·처음부터 재생', () => {
    const h = render({ seg: { ...SEG, scope: 'WHOLE' }, position: { from: 0, to: 1 } });
    expect(h).toContain('전체 재생</strong>');
    expect(h).toContain('처음부터 재생');
    expect(h).toContain('width:100%');
  });
  it('재생 중이면 정지, 토글은 aria-pressed', () => {
    const h = render({ playing: true, rate: 0.75, loop: true });
    expect(h).toContain('>정지<');
    expect(h.match(/aria-pressed="true"/g)).toHaveLength(2);
  });
  it('disabled', () => {
    expect(render({ disabled: true })).toContain('disabled');
    expect(render()).not.toContain('disabled');
  });
  it('막대 위치는 0~1로 클램프', () => {
    expect(render({ position: { from: -1, to: 3 } })).toContain('left:0%;width:100%');
  });
});
