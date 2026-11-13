// Figma 228:5881 — 한 손 스틱 연결이 끊겼을 때 캔버스 위 가운데에 얹는 띠(폭 560). 연주는 막지 않는다.
// 재연결 상태는 호출부(store/reconnectStore)가 넘긴다. 이 컴포넌트는 props만 받는다.
import { DEVICE_META, disconnectTitle, type DeviceId } from '@/domain/kit/device/devices';
import { Button } from '@/components/ui/action/Button';
import '@/components/stick/DisconnectNotice.css';
import './free.css';

export interface BandReconnect {
  status: 'idle' | 'trying' | 'failed' | 'reconnected';
  attempt: number;
  max: number;
  /** failed일 때 문구 뒤에 붙일 소스별 안내 */
  hint?: string;
}

interface Props {
  left: boolean;
  right: boolean;
  /** 페달 연결 여부. undefined면 P 점·문구를 그리지 않는다(동글이 아닌 소스) */
  pedal?: boolean;
  reconnect: BandReconnect;
  /** 없으면 [다시 연결]을 숨긴다(연결 동작이 없는 소스) */
  onReconnect?: () => void;
}

function Dot({ device, connected, pulse }: { device: DeviceId; connected: boolean; pulse?: boolean }) {
  return (
    <span className={`free-band-dot ${connected ? 'on' : 'off'}${pulse && !connected ? ' pulse' : ''}`} aria-hidden="true">
      {DEVICE_META[device].mark}
    </span>
  );
}

function subText(left: boolean, right: boolean, reconnect: BandReconnect): string {
  // 손이 둘 다 붙어 있으면(페달만 끊김) 스틱은 계속 칠 수 있다
  const alive = left && right ? '스틱' : left ? DEVICE_META.LEFT.name : DEVICE_META.RIGHT.name;
  if (reconnect.status === 'trying') return `다시 연결하는 중… (${reconnect.attempt}/${reconnect.max}) · ${alive}은 계속 칠 수 있어요`;
  if (reconnect.status === 'failed') return `연결하지 못했어요. ${reconnect.hint ?? '드럼 세팅에서 연결해 주세요'}`;
  return `${alive}은 계속 칠 수 있어요`;
}

export function DisconnectBand({ left, right, pedal, reconnect, onReconnect }: Props) {
  const trying = reconnect.status === 'trying';
  const reconnected = reconnect.status === 'reconnected';
  return (
    <div className="free-band motion-toast" role="status">
      <div className="free-band-dots">
        <Dot device="LEFT" connected={reconnected || left} pulse={trying} />
        <Dot device="RIGHT" connected={reconnected || right} pulse={trying} />
        {pedal !== undefined && <Dot device="PEDAL" connected={reconnected || pedal} pulse={trying} />}
      </div>
      <div className="free-band-text">
        <strong className="free-band-title">{reconnected ? '재연결 성공!' : disconnectTitle(left, right, pedal)}</strong>
        {!reconnected && (
          <span className="free-band-sub">
            {trying && <span className="stick-spinner" aria-hidden="true" />}
            {subText(left, right, reconnect)}
          </span>
        )}
      </div>
      {onReconnect && !reconnected && (
        <Button variant="text" onClick={onReconnect}>
          다시 연결
        </Button>
      )}
    </div>
  );
}
