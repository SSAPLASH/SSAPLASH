// ① 전송: 바이트가 제대로 도착하는가. 지표 줄(M) + 원시 hex·LOG, 브리지 통계 원본(N, 접힘).
import type { StageHealth } from '@/features/monitor/core/health';
import { HexStream } from '@/features/monitor/HexStream';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import type { Snap } from '@/features/monitor/monitorTypes';

export function TransportSection({ health, snap }: { health: StageHealth; snap: Snap }) {
  const { stats, transport } = snap;
  const b = stats.bridge;
  const rateText = ['hit', 'pose', 'status', 'syncAck', 'paramAck', 'log', 'swing', 'bridgeStats', 'out']
    .filter((k) => stats.ratePerType[k])
    .map((k) => `${k} ${stats.ratePerType[k]}`)
    .join(' · ');

  return (
    <div className="mon-section">
      <h2 className="mon-section-title">① 전송</h2>
      <MetricRow items={health.items} />
      <div className="mon-summary-line">
        타입별 패킷/초 <span className="faint">{rateText || '–'}</span>
      </div>
      <Fold id="transport.raw" title="원시 hex·LOG">
        <HexStream snap={snap} />
      </Fold>
      <Fold id="transport.bridge" title="브리지 통계 원본">
        <div className="mon-tiles">
          <div className={`mon-tile${b.stalled ? ' warn' : ''}`}>
            <div className="mon-tile-title">CRC 오류</div>
            <div className="mon-tile-body">
              브리지{' '}
              {b.last
                ? `${b.last.crcErrors} (+${b.delta1s.crcErrors}/s) · resync ${b.last.resyncCount} (+${b.delta1s.resyncCount}/s)`
                : '–'}
              {b.stalled && <div className="bad">브리지 멈춤 — 통계 {((b.ageMs ?? 0) / 1000).toFixed(1)}s 전</div>}
              <br />
              직결{' '}
              {transport
                ? `${transport.crcErrors} · resync ${transport.resyncCount} · 버림 ${transport.droppedBytes}B · 재연결 ${transport.reconnects}`
                : '–'}
            </div>
          </div>
          <div className="mon-tile">
            <div className="mon-tile-title">I2C REC / 오류 행</div>
            <div className="mon-tile-body">
              {stats.i2cRecoveries ?? '–'} / {stats.errorCount}
            </div>
          </div>
        </div>
      </Fold>
    </div>
  );
}
