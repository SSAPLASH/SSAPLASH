// 핵심 수치 바: 상단 바 아래에 고정되어 어느 섹션에서나 스틱 L·R의 가장 중요한 수치를 큰 글씨와 상태 색으로 보인다.
// 값·상태는 monitor/health.keyMetrics가 만든다(새 통계 없음). 페이지가 1초마다 한 번만 값을 새로 만들어 넘기므로 렌더 비용이 작다.
import { memo } from 'react';
import { HEALTH_THRESHOLDS, type KeyMetric, type StickKeyMetrics } from '@/features/monitor/core/health';

const CK = HEALTH_THRESHOLDS.clock;

interface Cell {
  label: string;
  /** 작은 기준 표기 */
  basis: string;
  pick: (m: StickKeyMetrics) => KeyMetric;
}

const CELLS: Cell[] = [
  { label: 'SYNC 왕복 최근', basis: `${CK.rttWarnMs}ms 초과 주의`, pick: (m) => m.rttLast },
  { label: 'SYNC 왕복 중앙값', basis: `${CK.rttWarnMs}ms 초과 주의 (최근 ${CK.rttRecent}개)`, pick: (m) => m.rttMedian },
  {
    label: '도착(수신−정지) 중앙값',
    basis: `정상 ${CK.arrivalNormalMinMs}~${CK.arrivalNormalMaxMs}ms`,
    pick: (m) => m.arrival,
  },
  { label: 'HIT 유실 (최근 1분)', basis: '1건 이상 주의', pick: (m) => m.hitLoss },
  { label: '수신 패킷/초', basis: '표시용', pick: (m) => m.rate },
];

export const KeyMetricsBar = memo(function KeyMetricsBar({ metrics }: { metrics: [StickKeyMetrics, StickKeyMetrics] }) {
  return (
    <div className="mon-keybar" role="group" aria-label="핵심 수치">
      {(['L', 'R'] as const).map((name, s) => (
        <div key={name} className="mon-keystick">
          <span className="mon-keyname">{name}</span>
          {CELLS.map((c) => {
            const m = c.pick(metrics[s]);
            return (
              <div key={c.label} className={`mon-key ${m.level}`} title={`${c.label} — 기준: ${c.basis}`}>
                <div className="mon-key-label">{c.label}</div>
                <div className="mon-key-value">
                  {m.value}
                  {m.unit && <span className="mon-metric-unit"> {m.unit}</span>}
                </div>
                <div className="mon-key-basis">{m.why ?? c.basis}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
