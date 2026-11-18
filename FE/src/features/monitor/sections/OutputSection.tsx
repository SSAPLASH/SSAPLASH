// ⑥ 출력: 소리가 제때 나는가. 지표 줄(M) + 구간 지연 시계열(N, 접힘).
import type { StageHealth } from '@/features/monitor/core/health';
import type { LatencyStatsLog } from '@/features/monitor/core/latencyStats';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import { LatencySeries } from '@/features/monitor/LatencySeries';
import type { Snap } from '@/features/monitor/monitorTypes';

export function OutputSection({ health, snap, latency }: { health: StageHealth; snap: Snap; latency: LatencyStatsLog }) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">⑥ 출력</h2>
      <MetricRow items={health.items} />
      <div className="mon-summary-line">
        표본 센서→수신 {snap.latency.recv.n}건 · 판정→오디오 {snap.latency.audio.n}건
        <span className="faint"> · 최근 200건 기준</span>
      </div>
      <Fold id="output.series" title="구간 지연 시계열">
        <LatencySeries points={latency.series()} tick={snap.tick} />
      </Fold>
    </div>
  );
}
