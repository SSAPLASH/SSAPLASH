// ② 센서: 스틱이 무엇을 보냈는가. 지표 줄(M) + HIT 표(M, 항상 보임) + POSE·SWING·세기 산점(N, 접힘).
import type { CalibrationProfile } from '@/domain/calibration';
import type { AngleRange } from '@/domain/kitMapping';
import type { StageHealth } from '@/monitor/health';
import type { SwingAssembler } from '@/monitor/swingAssembler';
import { HitTable } from '../HitTable';
import { Fold } from '../layout/Fold';
import { MetricRow } from '../layout/MetricRow';
import { fmt, type SendFn, type Snap } from '../monitorTypes';
import { PoseScope } from '../PoseScope';
import { SwingScope } from '../SwingScope';
import { VelocityScatter } from '../VelocityScatter';

export function SensorSection({
  health,
  snap,
  profile,
  angleRange,
  hitPick,
  onSelectHit,
  onPickHit,
  assembler,
  swingVersion,
  selectedSwing,
  onSelectSwing,
  openSwingSignal,
  send,
  canSend,
}: {
  health: StageHealth;
  snap: Snap;
  profile: CalibrationProfile;
  angleRange: AngleRange;
  /** 세기 산점에서 고른 HIT 행 */
  hitPick: { stick: 0 | 1; seq: number } | null;
  /** HIT 행 클릭: 페이지가 SWING 선택과 패널 펼침을 맡는다 */
  onSelectHit: (stick: 0 | 1, seq: number) => void;
  /** 산점 점 클릭: 페이지가 HIT 행 선택을 맡는다 */
  onPickHit: (stick: 0 | 1, seq: number) => void;
  assembler: SwingAssembler;
  swingVersion: number;
  selectedSwing: string | null;
  onSelectSwing: (key: string) => void;
  /** 올라갈 때마다 SWING 패널을 연다 */
  openSwingSignal: number;
  send: SendFn;
  canSend: boolean;
}) {
  const { stats } = snap;
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">② 센서</h2>
      <MetricRow items={health.items} />
      <div className="mon-status-row">
        {([0, 1] as const).map((s) => {
          const pkt = stats.perStick[s].lastStatus;
          const age = stats.perStick[s].statusAgeMs;
          return (
            <span key={s} className="mon-status" style={{ borderColor: s === 0 ? 'var(--left)' : 'var(--right)' }}>
              <strong style={{ color: s === 0 ? 'var(--left)' : 'var(--right)' }}>{s === 0 ? 'L' : 'R'}</strong>
              {pkt ? (
                <>
                  {' '}
                  배터리 {pkt.batteryPct === null ? '–' : `${pkt.batteryPct}%`} · RSSI {pkt.rssi} · fw {pkt.fwMajor}.{pkt.fwMinor} · STATUS{' '}
                  {fmt(age === null ? null : age / 1000)}s 전
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
      <HitTable snap={snap} profile={profile} onSelectHit={onSelectHit} selected={hitPick} />
      <Fold id="sensor.pose" title="POSE·자세 평면">
        <PoseScope snap={snap} profile={profile} angleRange={angleRange} />
      </Fold>
      <Fold id="sensor.swing" title="원시 파형(SWING)" openSignal={openSwingSignal}>
        <SwingScope
          assembler={assembler}
          version={swingVersion}
          selectedKey={selectedSwing}
          onSelect={onSelectSwing}
          send={send}
          canSend={canSend}
          rows={snap.rows}
        />
      </Fold>
      <Fold id="sensor.velocity" title="세기 산점">
        <VelocityScatter snap={snap} onPick={onPickHit} />
      </Fold>
    </div>
  );
}
