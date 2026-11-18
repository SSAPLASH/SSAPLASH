import { NavLink } from 'react-router-dom';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { DEVICE_META, deviceGroupName } from '@/domain/kit/device/devices';
import { stickStatus } from '@/domain/kit/device/stickStatus';
import { skewedDevices, type ArrivalDevice, type ClockSkew } from '@/domain/kit/device/arrivalSkew';
import { pedalRequired, pedalStatus, type PedalView } from '@/domain/kit/device/pedalStatus';

interface ChipProps {
  connected: readonly [boolean, boolean];
  battery: readonly [number | null, number | null];
  /** 있으면 손 조각 오른쪽에 페달 조각을 그린다(동글 소스일 때만 넘긴다) */
  pedal?: PedalView;
  /** 기기 사이 시각 차이 경고 중인 기기(PLAY-006). 연결된 기기의 점만 주황으로 바꾼다 */
  skewed?: readonly ArrivalDevice[];
}

const SKEW_TEXT = '시간 어긋남';

/** 칩 본체(표시만, Figma Shell / StickStatus 262:1270: h32 · px12 · gap10 · 점 6). 스토어는 StickStatusIndicator가 읽는다.
 *  6상태(ok/left-off/right-off/low/unknown/both-off)는 stickStatus() 결과(점 on/off · 배터리 low/unknown)의 조합으로 그려진다 */
export function StickStatusChip({ connected, battery, pedal, skewed = [] }: ChipProps) {
  const pv = pedal ? pedalStatus(pedal) : null;
  const handWarn = ([0, 1] as const).map((hand) => connected[hand] && skewed.includes(hand === 0 ? 'left' : 'right'));
  const pedalWarn = pv !== null && pv.dot === 'on' && skewed.includes('pedal');
  const anyWarn = handWarn.some(Boolean) || pedalWarn;
  return (
    <NavLink to="/setup" className="stick-status" aria-label={`${deviceGroupName(pedal !== undefined)} 연결 상태${anyWarn ? ` · ${SKEW_TEXT}` : ''}`}>
      {([0, 1] as const).map((hand) => {
        const v = stickStatus(connected[hand], battery[hand], hand);
        return (
          <span key={hand} className={`stick-status-hand ${v.dot}`} title={handWarn[hand] ? `${v.text} · ${SKEW_TEXT}` : v.text}>
            {v.label}
            <span className={`stick-dot ${v.dot}${handWarn[hand] ? ' warn' : ''}`} />
            <span className={`stick-batt ${v.battery}`}>{v.batteryText}</span>
          </span>
        );
      })}
      {pv && (
        <span className={`stick-status-hand ${pv.dot}`} title={pedalWarn ? `${pv.text} · ${SKEW_TEXT}` : pv.text}>
          {DEVICE_META.PEDAL.chip}
          <span className={`stick-dot ${pv.dot}${pedalWarn ? ' warn' : ''}`} />
          {pv.batteryText && <span className="stick-batt ok">{pv.batteryText}</span>}
        </span>
      )}
    </NavLink>
  );
}

/** 셸 오른쪽 위 칩: "왼 ● 82%  오 ● 64%  페달 ● 90%"(페달은 동글 소스만). 누르면 세팅(스틱 연결)으로 간다. 키보드 전용이면 숨긴다 */
export function StickStatusIndicator() {
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((s) => s.connected);
  const battery = useLive((s) => s.battery);
  const pedal = useLive((s) => s.pedal);
  const clockSkew: ClockSkew | null = useLive((s) => s.clockSkew);
  if (sensorKind === 'none') return null;
  return (
    <StickStatusChip
      connected={connected}
      battery={battery}
      pedal={pedalRequired(sensorKind) ? pedal : undefined}
      skewed={clockSkew ? skewedDevices(clockSkew) : undefined}
    />
  );
}
