// 전송 패널: 스틱별 STATUS 줄 + 요약 타일 1줄. 계산은 packetLog.stats()가 끝냈고 여기는 표시만 한다.
import { memo } from 'react';
import { fmt, type Snap } from './monitorTypes';

const STATUS_WARN_MS = 12_000;

function Tile({ title, children, warn }: { title: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`mon-tile${warn ? ' warn' : ''}`}>
      <div className="mon-tile-title">{title}</div>
      <div className="mon-tile-body">{children}</div>
    </div>
  );
}

const lagRange = (lags: number[]): string =>
  lags.length === 0 ? '–' : `${Math.min(...lags).toFixed(1)}~${Math.max(...lags).toFixed(1)}`;

export const TransportPanel = memo(function TransportPanel({ snap }: { snap: Snap }) {
  const { stats, transport, offsets } = snap;
  const rate = stats.ratePerType;
  const rateText = ['hit', 'pose', 'status', 'syncAck', 'paramAck', 'log', 'swing', 'bridgeStats', 'out']
    .filter((k) => rate[k])
    .map((k) => `${k} ${rate[k]}`)
    .join(' · ');
  const dropText = Object.entries(stats.drops)
    .map(([reason, v]) => `${reason} ${v.total}(+${v.window})`)
    .join(' · ');
  const b = stats.bridge;

  return (
    <div className="mon-transport">
      <div className="mon-status-row">
        {([0, 1] as const).map((s) => {
          const st = stats.perStick[s];
          const pkt = st.lastStatus;
          const age = st.statusAgeMs;
          const stale = age !== null && age > STATUS_WARN_MS;
          return (
            <span key={s} className="mon-status" style={{ borderColor: s === 0 ? 'var(--left)' : 'var(--right)' }}>
              <strong style={{ color: s === 0 ? 'var(--left)' : 'var(--right)' }}>{s === 0 ? 'L' : 'R'}</strong>
              {pkt ? (
                <>
                  {' '}
                  배터리 {pkt.batteryPct === null ? '–' : `${pkt.batteryPct}%`} · RSSI {pkt.rssi} · fw {pkt.fwMajor}.{pkt.fwMinor} ·{' '}
                  <span className={stale ? 'bad' : ''}>
                    STATUS {age === null ? '–' : `${(age / 1000).toFixed(1)}s`} 전{stale ? ' (끊김?)' : ''}
                  </span>
                </>
              ) : (
                <span className="faint"> STATUS 없음</span>
              )}
            </span>
          );
        })}
        <span className="mon-status">
          <span className="faint">build</span> {stats.build ?? '–'}
        </span>
      </div>

      <div className="mon-tiles">
        <Tile title="패킷/초">{rateText || '–'}</Tile>
        <Tile title="HIT 유실 (1초 / 누적)">
          L {stats.perStick[0].hitSeqLoss.window} / {stats.perStick[0].hitSeqLoss.total} · R {stats.perStick[1].hitSeqLoss.window} /{' '}
          {stats.perStick[1].hitSeqLoss.total}
        </Tile>
        <Tile title="POSE 유실률">
          L {stats.perStick[0].poseSeqLoss.pct === null ? '–' : `${stats.perStick[0].poseSeqLoss.pct.toFixed(1)}%`} · R{' '}
          {stats.perStick[1].poseSeqLoss.pct === null ? '–' : `${stats.perStick[1].poseSeqLoss.pct.toFixed(1)}%`}
        </Tile>
        <Tile title="CRC 오류" warn={b.stalled}>
          브리지 {b.last ? `${b.last.crcErrors} (+${b.delta1s.crcErrors}/s) · resync ${b.last.resyncCount} (+${b.delta1s.resyncCount}/s)` : '–'}
          {b.stalled && <div className="bad">브리지 멈춤 — 통계 {((b.ageMs ?? 0) / 1000).toFixed(1)}s 전</div>}
          <br />
          직결 {transport ? `${transport.crcErrors} · resync ${transport.resyncCount} · 버림 ${transport.droppedBytes}B · 재연결 ${transport.reconnects}` : '–'}
        </Tile>
        <Tile title="시계 오프셋(ms)">
          L {fmt(offsets[0])} · R {fmt(offsets[1])}
        </Tile>
        <Tile title="SYNC_ACK 지연(ms)">
          마지막 {fmt(stats.syncAck.lastLagMs)} · 최근 {stats.syncAck.lags.length}개 {lagRange(stats.syncAck.lags)} · 수신 {stats.syncAck.count}
        </Tile>
        <Tile title="HIT futureMs 중앙값/최대">
          L {fmt(stats.perStick[0].hitFuture.median)}/{fmt(stats.perStick[0].hitFuture.max)} · R {fmt(stats.perStick[1].hitFuture.median)}/
          {fmt(stats.perStick[1].hitFuture.max)}
        </Tile>
        <Tile title="거른 스윙 (누적, +1초)">{dropText || '–'}</Tile>
        <Tile title="I2C REC / 오류 행">
          {stats.i2cRecoveries ?? '–'} / {stats.errorCount}
        </Tile>
      </div>
    </div>
  );
});
