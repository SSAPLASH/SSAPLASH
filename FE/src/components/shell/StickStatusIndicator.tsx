import { NavLink } from 'react-router-dom';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { stickStatus } from '@/domain/stickStatus';

interface ChipProps {
  connected: readonly [boolean, boolean];
  battery: readonly [number | null, number | null];
}

/** 칩 본체(표시만, Figma Shell / StickStatus 262:1270: h32 · px12 · gap10 · 점 6). 스토어는 StickStatusIndicator가 읽는다.
 *  6상태(ok/left-off/right-off/low/unknown/both-off)는 stickStatus() 결과(점 on/off · 배터리 low/unknown)의 조합으로 그려진다 */
export function StickStatusChip({ connected, battery }: ChipProps) {
  return (
    <NavLink to="/setup" className="stick-status" aria-label="스틱 연결 상태">
      {([0, 1] as const).map((hand) => {
        const v = stickStatus(connected[hand], battery[hand], hand);
        return (
          <span key={hand} className={`stick-status-hand ${v.dot}`} title={v.text}>
            {v.label}
            <span className={`stick-dot ${v.dot}`} />
            <span className={`stick-batt ${v.battery}`}>{v.batteryText}</span>
          </span>
        );
      })}
    </NavLink>
  );
}

/** 셸 오른쪽 위 칩: "왼 ● 82%  오 ● 64%". 누르면 세팅(스틱 연결)으로 간다. 키보드 전용이면 숨긴다 */
export function StickStatusIndicator() {
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((s) => s.connected);
  const battery = useLive((s) => s.battery);
  if (sensorKind === 'none') return null;
  return <StickStatusChip connected={connected} battery={battery} />;
}
