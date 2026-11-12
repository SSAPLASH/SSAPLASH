// 박자 맞추기 대화상자 표시 검증: 안내 → 진행(박 점) → 결과 3종.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TimingCalSnapshot } from '@/runtime/timingCalSession';
import { TimingCalView } from './TimingCalDialog';

const noop = () => {};
const base: TimingCalSnapshot = { phase: 'idle', beat: 0, taps: 0, result: null, outputLatencyMs: null };
const view = (snap: Partial<TimingCalSnapshot>, currentOffsetMs = 0) =>
  renderToStaticMarkup(
    <TimingCalView snap={{ ...base, ...snap }} currentOffsetMs={currentOffsetMs} titleId="t" onStart={noop} onApply={noop} onClose={noop} />,
  );
const count = (html: string, s: string) => html.split(s).length - 1;

describe('TimingCalView', () => {
  it('대기: 안내와 [시작]·[닫기]', () => {
    const html = view({});
    expect(html).toContain('박자 맞추기');
    expect(html).toContain('처음 4번은 듣기만');
    expect(html).toContain('시작');
    expect(html).toContain('닫기');
    expect(html).not.toContain('timing-cal-beats');
  });

  it('오디오 준비 중에는 [시작]이 비활성', () => {
    expect(view({ phase: 'starting' })).toMatch(/<button[^>]*disabled[^>]*>시작/);
  });

  it('듣기: 박 점 16개(앞 4개는 듣기), 울린 박만 켠다', () => {
    const html = view({ phase: 'listen', beat: 2 });
    expect(html).toContain('듣기만 하세요');
    expect(html.match(/<span class="timing-cal-beat[ "]/g)).toHaveLength(16);
    expect(count(html, 'timing-cal-beat listen')).toBe(4);
    expect(html.match(/timing-cal-beat[a-z ]* on/g)).toHaveLength(2);
    expect(html.match(/timing-cal-beat[a-z ]* now/g)).toHaveLength(1);
    expect(html).toContain('취소');
  });

  it('측정: 안내가 바뀌고 받은 타격 수를 보인다', () => {
    const html = view({ phase: 'measure', beat: 9, taps: 5 });
    expect(html).toContain('클릭에 맞춰 치세요');
    expect(html).toContain('받은 타격 5 / 12');
  });

  it('성공: 지금 값 → 새 값과 [적용]·[다시 하기]·[취소]', () => {
    const html = view(
      { phase: 'result', beat: 16, result: { status: 'ok', pairs: 12, medianMs: -66, madMs: 8, offsetMs: -65, input: 'sensor' }, outputLatencyMs: 40 },
      -10,
    );
    expect(html).toContain('클릭보다 평균 66ms 일찍 쳤어요.');
    expect(html).toContain('-10ms');
    expect(html).toContain('-65ms');
    expect(html).toContain('적용');
    expect(html).toContain('다시 하기');
    expect(html).not.toContain('timing-cal-warn');
  });

  it('성공이어도 보고된 출력 지연이 크면 유선 출력을 권한다', () => {
    const html = view({
      phase: 'result',
      result: { status: 'ok', pairs: 12, medianMs: -200, madMs: 8, offsetMs: -200, input: 'sensor' },
      outputLatencyMs: 180,
    });
    expect(html).toContain('timing-cal-warn');
    expect(html).toContain('180ms 늦게');
  });

  it('표본 부족·흩어짐 큼: 이유와 [다시 하기]만 있고 [적용]은 없다', () => {
    for (const status of ['few', 'scattered'] as const) {
      const html = view({ phase: 'result', result: { status, pairs: 3, medianMs: -50, madMs: 60, offsetMs: null, input: 'sensor' } });
      expect(html).toContain('다시 하기');
      expect(html).not.toContain('적용');
      expect(html).not.toContain('timing-cal-change');
    }
  });
});
