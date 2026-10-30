import { stickStatus } from '@/domain/stickStatus';

interface Props {
  /** 0 왼손, 1 오른손 */
  hand: 0 | 1;
  connected: boolean;
  batteryPct: number | null;
}

/** 세팅 ① 본문의 손별 카드. 연결 점·문구·배터리만 보인다(연결은 스틱의 버튼이 맡아 FE 버튼은 없다) */
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
      </div>
      {!connected && <p className="stick-card-hint">스틱의 연결 버튼을 눌러 주세요</p>}
    </div>
  );
}
