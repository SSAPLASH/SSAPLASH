// 세팅 안내 규칙. 연주가 아니라 소리 지연이나 패드 위치가 원인으로 보일 때 세팅을 안내한다.
// 사람의 박자 습관은 흔들리지만 기기 지연은 거의 일정하다. 치긴 쳤는데 다른 패드로 들어가면 패드 위치를 의심한다.
// 상태를 갖지 않는 순수 함수다. 플레이당 한 번만 띄우는 것은 LiveCoach가 맡는다.
import { LIVE_COACH_CONFIG } from './config';
import type { LiveTag, RuleEvaluation } from './rules';
import type { WindowMetrics } from './window';

/** 지적보다 먼저 띄운다. 원인이 세팅이면 연주 지적은 도움이 되지 않는다 */
const SETUP_PRIORITY = -1;

export const SETUP_TAGS: readonly LiveTag[] = ['LIVE_SETUP_OFFSET', 'LIVE_SETUP_PADS'];

/** 스틱 입력인가. 세팅 안내는 스틱에서만 뜬다(키보드·포인터는 패드 위치와 기기 지연이 다르다) */
export function isStickSensor(sensorKind: string): boolean {
  return sensorKind === 'ble' || sensorKind === 'websocket';
}

/** 플레이 로그에서 이 판에 뜬 세팅 안내 태그를 고른다 */
export function setupTagsOf(events: readonly { tag: string }[] | undefined): string[] {
  return (events ?? []).map((e) => e.tag).filter((tag) => (SETUP_TAGS as readonly string[]).includes(tag));
}

export function evaluateSetupHints(m: WindowMetrics): RuleEvaluation[] {
  const c = LIVE_COACH_CONFIG.setup;
  const s = m.setup;
  const steadyOffset =
    s.validCount >= c.minValid &&
    s.meanDelta !== null &&
    Math.abs(s.meanDelta) >= c.offsetMeanMs &&
    s.stdDelta !== null &&
    s.stdDelta < c.offsetMaxStdMs &&
    (s.sameSignRatio ?? 0) >= c.offsetSameSign;
  const strayMisses =
    s.judged >= c.window && s.misses / s.judged >= c.padsMissRate && s.strayHits >= s.misses * c.padsStrayRatio;
  return [
    {
      key: 'LIVE_SETUP_OFFSET',
      tag: 'LIVE_SETUP_OFFSET',
      priority: SETUP_PRIORITY,
      trigger: steadyOffset,
      release: false,
      severity: 1,
      text: '소리 타이밍이 일정하게 어긋나요. 설정에서 박자 맞추기를 해 보세요.',
      target: null,
    },
    {
      key: 'LIVE_SETUP_PADS',
      tag: 'LIVE_SETUP_PADS',
      priority: SETUP_PRIORITY,
      trigger: strayMisses,
      release: false,
      severity: 1,
      text: '다른 패드로 들어가는 타격이 많아요. 세팅에서 패드 위치를 확인해 보세요.',
      target: null,
    },
  ];
}
