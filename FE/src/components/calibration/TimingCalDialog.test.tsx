// 박자 맞추기 대화상자 표시 검증: 안내 → 진행(박 점) → 결과 3종.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TimingCalSnapshot } from '@/runtime/timingCalSession';
import type { TimingCalOutcome, TimingCalResult } from '@/domain/kit/calibration/timingCalibration';
import { TimingCalView } from './TimingCalDialog';

const noop = () => {};
const base: TimingCalSnapshot = { phase: 'idle', beat: 0, withKick: false, totalBeats: 16, taps: 0, outcome: null, outputLatencyMs: null };
const okRes = (medianMs: number, offsetMs: number): TimingCalResult => ({ status: 'ok', pairs: 12, medianMs, madMs: 8, offsetMs, input: 'sensor' });
const failRes: TimingCalResult = { status: 'few', pairs: 3, medianMs: null, madMs: null, offsetMs: null, input: 'sensor' };
const outcome = (stick: TimingCalResult, kick: TimingCalResult | null = null, recheck = false): TimingCalOutcome => ({ stick, kick, recheck });
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
    // 안내는 두 줄: 「…쳐 주세요.」 뒤에서 줄을 나눈다
    expect(html).toContain('아무 패드나 쳐 주세요.<br/>처음 4번은 듣기만');
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
      { phase: 'result', beat: 16, outcome: outcome(okRes(-66, -65)), outputLatencyMs: 40 },
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
      outcome: outcome(okRes(-200, -200)),
      outputLatencyMs: 180,
    });
    expect(html).toContain('timing-cal-warn');
    expect(html).toContain('180ms 늦게');
  });

  it('표본 부족·흩어짐 큼: 이유와 [다시 하기]만 있고 [적용]은 없다', () => {
    for (const status of ['few', 'scattered'] as const) {
      const html = view({ phase: 'result', outcome: outcome({ status, pairs: 3, medianMs: -50, madMs: 60, offsetMs: null, input: 'sensor' }) });
      expect(html).toContain('다시 하기');
      expect(html).not.toContain('적용');
      expect(html).not.toContain('timing-cal-change');
    }
  });

  it('킥 구간: 전환 박 안내와 그 구간의 박 점만 보인다', () => {
    const sw = view({ phase: 'switch', withKick: true, totalBeats: 32, beat: 18 });
    expect(sw).toContain('이제 킥 페달로 바꿔요');
    expect(sw).not.toContain('받은 타격');
    expect(sw.match(/<span class="timing-cal-beat[ "]/g)).toHaveLength(16);
    expect(count(sw, 'timing-cal-beat listen')).toBe(4);
    const kick = view({ phase: 'kick', withKick: true, totalBeats: 32, beat: 25, taps: 3 });
    expect(kick).toContain('킥 페달로 박에 맞춰 밟으세요');
    expect(kick).toContain('받은 타격 3 / 12');
  });

  it('스틱 구간 안내 문구', () => {
    expect(view({ phase: 'measure', withKick: true, totalBeats: 32, beat: 9 })).toContain('스틱으로 박에 맞춰 치세요');
  });

  it('킥 포함 성공: 스틱·킥 값을 각각 한 줄로 보이고 recheck 안내는 없다', () => {
    const html = view({ phase: 'result', withKick: true, totalBeats: 32, outcome: outcome(okRes(-66, -65), okRes(-41, -40)) }, -10);
    expect(html).toContain('스틱');
    expect(html).toContain('-65ms');
    expect(html).toContain('킥');
    expect(html).toContain('-40ms');
    expect(count(html, 'timing-cal-change')).toBe(2);
    expect(html).not.toContain('한 번 더 재 볼까요');
    expect(html).toContain('적용');
  });

  it('킥 구간이 없었으면 킥 줄이 없다', () => {
    const html = view({ phase: 'result', outcome: outcome(okRes(-66, -65)) });
    expect(count(html, 'timing-cal-change')).toBe(1);
    expect(html).not.toContain('킥');
  });

  it('킥만 실패: 안내 문구를 보이고 [적용]은 남는다', () => {
    const html = view({ phase: 'result', withKick: true, totalBeats: 32, outcome: outcome(okRes(-66, -65), failRes) });
    expect(html).toContain('킥은 값을 얻지 못했어요. 스틱 값을 같이 써요.');
    expect(html).toContain('적용');
  });

  it('스틱 실패: 실패 안내만 보이고 [적용]은 막는다', () => {
    const html = view({ phase: 'result', withKick: true, totalBeats: 32, outcome: outcome(failRes, okRes(-41, -40)) });
    expect(html).toContain('박에 맞은 타격이 3번뿐이에요');
    expect(html).not.toContain('적용');
    expect(html).not.toContain('timing-cal-change');
  });

  it('recheck면 결과 위에 다시 재 보라는 안내를 보이되 [적용]은 막지 않는다', () => {
    const html = view({ phase: 'result', withKick: true, totalBeats: 32, outcome: outcome(okRes(-110, -110), okRes(-41, -40), true) });
    expect(html).toContain('스틱과 킥 값이 60ms 넘게 달라요. 한 번 더 재 볼까요?');
    expect(html.indexOf('한 번 더 재 볼까요')).toBeLessThan(html.indexOf('timing-cal-change'));
    expect(html).toContain('적용');
  });
});

describe('TimingCalView intro (첫 연주 전 권유)', () => {
  const introView = (snap: Partial<TimingCalSnapshot>) =>
    renderToStaticMarkup(
      <TimingCalView snap={{ ...base, ...snap }} currentOffsetMs={0} titleId="t" onStart={noop} onApply={noop} onClose={noop} intro />,
    );

  it('안내 단계: 한 줄 안내가 위에 있고 닫기 버튼 글자가 [나중에 하기]다', () => {
    const html = introView({});
    expect(html).toContain('처음 한 번만 박자를 맞추면 판정이 정확해져요.');
    expect(html).toContain('나중에 하기');
    expect(html).not.toContain('>닫기<');
    expect(html.indexOf('처음 한 번만')).toBeLessThan(html.indexOf('처음 4번은 듣기만'));
  });

  it('intro가 아니면 한 줄 안내가 없고 [닫기]다', () => {
    const html = view({});
    expect(html).not.toContain('처음 한 번만');
    expect(html).not.toContain('나중에 하기');
  });

  it('진행·결과 단계는 intro여도 같다', () => {
    expect(introView({ phase: 'listen', beat: 1 })).toContain('취소');
    expect(introView({ phase: 'result', beat: 16, outcome: outcome(okRes(-66, -65)) })).not.toContain('나중에 하기');
  });
});
