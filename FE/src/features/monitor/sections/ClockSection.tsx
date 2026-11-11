// ③ 시계: 센서 시각이 브라우저 시각으로 맞게 옮겨지는가. 지표 줄(M) + 동기화 추이(N, 접힘).
import type { StageHealth } from '@/features/monitor/core/health';
import type { LossHistory } from '@/features/monitor/core/syncTrend';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import type { Snap } from '@/features/monitor/monitorTypes';
import { SyncScope } from '@/features/monitor/SyncScope';

export function ClockSection({
  health,
  snap,
  loss,
  openTrendSignal,
}: {
  health: StageHealth;
  snap: Snap;
  loss: LossHistory;
  /** 올라갈 때마다 추이 패널을 연다(개요 ③ 클릭) */
  openTrendSignal: number;
}) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">③ 시계</h2>
      <MetricRow items={health.items} />
      <Fold id="clock.trend" title="동기화 추이" openSignal={openTrendSignal}>
        <SyncScope snap={snap} loss={loss} />
      </Fold>
    </div>
  );
}
