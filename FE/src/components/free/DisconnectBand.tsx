// Figma 228:5881 — 한 손 스틱 연결이 끊겼을 때 캔버스 위 가운데에 얹는 띠(폭 560). 연주는 막지 않는다.
// 재연결 상태는 호출부(store/reconnectStore)가 넘긴다. 이 컴포넌트는 props만 받는다.
import { Button } from '@/components/ui/Button';
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
  reconnect: BandReconnect;
  /** 없으면 [다시 연결]을 숨긴다(연결 동작이 없는 소스) */
  onReconnect?: () => void;
}

function Dot({ hand, connected, pulse }: { hand: 'L' | 'R'; connected: boolean; pulse?: boolean }) {
  return (
    <span className={`free-band-dot ${connected ? 'on' : 'off'}${pulse && !connected ? ' pulse' : ''}`} aria-hidden="true">
      {hand}
    </span>
  );
}

function subText(left: boolean, reconnect: BandReconnect): string {
  const alive = left ? '왼손' : '오른손';
  if (reconnect.status === 'trying') return `다시 연결하는 중… (${reconnect.attempt}/${reconnect.max}) · ${alive}은 계속 칠 수 있어요`;
  if (reconnect.status === 'failed') return `연결하지 못했어요. ${reconnect.hint ?? '드럼 세팅에서 연결해 주세요'}`;
  return `${alive}은 계속 칠 수 있어요`;
}

export function DisconnectBand({ left, right, reconnect, onReconnect }: Props) {
  const trying = reconnect.status === 'trying';
  const reconnected = reconnect.status === 'reconnected';
  return (
    <div className="free-band motion-toast" role="status">
      <div className="free-band-dots">
        <Dot hand="L" connected={reconnected || left} pulse={trying} />
        <Dot hand="R" connected={reconnected || right} pulse={trying} />
      </div>
      <div className="free-band-text">
        <strong className="free-band-title">{reconnected ? '재연결 성공!' : `${left ? '오른손' : '왼손'} 스틱 연결이 끊겼어요`}</strong>
        {!reconnected && (
          <span className="free-band-sub">
            {trying && <span className="stick-spinner" aria-hidden="true" />}
            {subText(left, reconnect)}
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
