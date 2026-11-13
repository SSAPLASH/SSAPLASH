import { STICK_POWER_HINT } from '@/domain/kit/calibration/setupSteps';
import { stickStatus } from '@/domain/kit/device/stickStatus';

interface Props {
  /** 0 왼손, 1 오른손 */
  hand: 0 | 1;
  connected: boolean;
  batteryPct: number | null;
}

/** 세팅 ① 본문의 손별 카드. 연결 점·문구·배터리만 보인다(스틱은 켜지면 동글에 자동으로 붙어 FE 버튼은 없다) */
export function StickCard({ hand, connected, batteryPct }: Props) {
  const v = stickStatus(connected, batteryPct, hand);
  return (
    <div className={`stick-card ${v.dot}`}>
      <div className="stick-card-head">
        <span className={`stick-dot ${v.dot}`} />
        {v.handName}
        <span className="stick-card-state">{connected ? '연결됨' : '연결 안 됨'}</span>
      </div>
      <div className="stick-card-battery">
        배터리 <span className={`stick-batt ${v.battery}`}>{v.batteryText}</span>
        {connected && v.battery === 'critical' && <span className="stick-batt critical"> · 곧 꺼짐</span>}
      </div>
      {!connected && <p className="stick-card-hint">{STICK_POWER_HINT}</p>}
    </div>
  );
}
