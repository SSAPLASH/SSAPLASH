// 센서 시계 오프셋 진단 줄(clock). 10초마다, 그리고 곡 시작 직후 1회 낸다(설계 PLAY-002 live-play-diagnostics 3-1).
// 모니터가 보고 있지 않거나 활성 센서가 없으면 즉시 반환해 비용을 얹지 않는다(D7).
import type { InputSource } from '@/input/source/InputSource';
import { diagTap } from '@/engine/diagTap';
import { onDiagSessionStart } from '@/engine/diagReport';

/** clock 진단 줄 주기(ms) */
export const CLOCK_DIAG_INTERVAL_MS = 10_000;

/** role 0~3(왼손·오른손·페달 둘)의 오프셋(브라우저 − 센서, ms)을 한 줄로 낸다. 미동기·미연결은 null */
export function publishClock(src: InputSource | null): void {
  if (!diagTap.active || !src) return;
  const of = (role: 0 | 1 | 2 | 3): number | null => src.clockOffsetOf?.(role) ?? null;
  diagTap.publish({ type: 'clock', offsets: [of(0), of(1), of(2), of(3)], source: src.kind });
}

/** 주기 타이머와 곡 시작 훅을 건다. getSource는 지금 활성인 센서 소스(없으면 null). 반환값은 해제 함수 */
export function startClockDiag(getSource: () => InputSource | null): () => void {
  const tick = () => publishClock(getSource());
  const timer = globalThis.setInterval(tick, CLOCK_DIAG_INTERVAL_MS);
  onDiagSessionStart(tick);
  return () => {
    globalThis.clearInterval(timer);
    onDiagSessionStart(null);
  };
}
