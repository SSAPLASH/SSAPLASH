// ④ 판정: 타격이 어떤 패드·세기로 결정됐는가. 지표 줄(M) + 세기 곡선(N, 접힘).
import { useMemo } from 'react';
import type { StageHealth } from '@/features/monitor/core/health';
import type { JudgeLog } from '@/features/monitor/core/recording/judgeLog';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import type { Snap } from '@/features/monitor/monitorTypes';
import { VelocityCurve } from '@/features/monitor/VelocityCurve';

/** 접힌 동안은 렌더되지 않으므로 짝 찾기(패킷 로그 검색)도 펼쳤을 때만 돈다 */
function VelocityCurvePanel({ judgeLog, snap }: { judgeLog: JudgeLog; snap: Snap }) {
  // snap.rows는 100ms 스냅샷마다 새 복사본이라 그때마다 다시 계산된다
  const pairs = useMemo(() => judgeLog.velocityPairs(snap.rows), [judgeLog, snap.rows]);
  return <VelocityCurve pairs={pairs} />;
}

export function ResolveSection({ health, snap, judgeLog }: { health: StageHealth; snap: Snap; judgeLog: JudgeLog }) {
  const r = snap.judge.resolve;
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">④ 판정</h2>
      <MetricRow items={health.items} />
      <div className="mon-summary-line">
        최근 판정 {r.total}건 보관
        <span className="faint"> · 입력 소스가 낸 타격(bootstrap의 resolved) 기준입니다. 따라보기면 연주 창의 타격입니다</span>
      </div>
      <Fold id="resolve.velocity" title="세기 곡선 (스틱 velocity → FE velocity)">
        <VelocityCurvePanel judgeLog={judgeLog} snap={snap} />
      </Fold>
    </div>
  );
}
