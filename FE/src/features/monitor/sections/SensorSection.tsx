// ② 센서: 스틱이 무엇을 보냈는가. 지표 줄(M) + HIT 표(M, 항상 보임) + POSE·SWING·세기 산점(N, 접힘).
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import type { AngleRange } from '@/domain/kit/kitMapping';
import type { StageHealth } from '@/features/monitor/core/health';
import type { PedalStats } from '@/features/monitor/core/recording/packetLog';
import type { SwingAssembler } from '@/features/monitor/core/swingAssembler';
import { HitTable } from '@/features/monitor/HitTable';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import { fmt, type SendFn, type Snap } from '@/features/monitor/monitorTypes';
import { PoseScope } from '@/features/monitor/PoseScope';
import { SwingScope } from '@/features/monitor/SwingScope';
import { VelocityScatter } from '@/features/monitor/VelocityScatter';

/** 페달 보드(role 2·3) 칸. 손 L·R과 따로 보인다. 보드 하나가 두 role을 같은 시계로 보내므로 시계 값은 한 묶음이다 */
function PedalStatus({ pedal, adoptedMs }: { pedal: PedalStats; adoptedMs: number | null }) {
  // STATUS는 role 2(하이햇 페달) 것을 먼저, 없으면 role 3(킥) 것을 쓴다
  const idx = pedal.lastStatus[0] ? 0 : 1;
  const pkt = pedal.lastStatus[idx];
  const age = pedal.statusAgeMs[idx];
  const { sync } = pedal;
  return (
    <span className="mon-status" title="페달 보드(role 2·3). SYNC는 role 2 응답만 센다">
      <strong>페달</strong>
      {pkt ? (
        <>
          {' '}
          배터리 {pkt.batteryPct === null ? '–' : `${pkt.batteryPct}%`} · fw {pkt.fwMajor}.{pkt.fwMinor} · STATUS {fmt(age === null ? null : age / 1000)}s 전
        </>
      ) : (
        <span className="faint"> STATUS 없음</span>
      )}
      {' · '}SYNC rtt 최근/최소 {fmt(sync.lastRttMs)}/{fmt(sync.minRttMs)}ms · 오프셋 관측/채택 {fmt(sync.offsetObsMs, 2)}/{fmt(adoptedMs, 2)}ms · 짝 실패{' '}
      <span className={sync.unmatched > 0 ? 'warn' : ''}>{sync.unmatched}</span>/{sync.count}
    </span>
  );
}

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
  onSelectHit: (stick: 0 | 1, seq: number, t: number) => void;
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
        {stats.pedal.present && <PedalStatus pedal={stats.pedal} adoptedMs={snap.pedalOffset} />}
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
