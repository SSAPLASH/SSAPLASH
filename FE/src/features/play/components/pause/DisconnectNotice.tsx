// 연결 끊김 카드 (Figma Play / DisconnectNotice 228:1138, 10/31 재구성). 420 카드 안에 L·R(동글이면 P) 연결 점, 제목, 재연결 상태 문구, 버튼 둘.
// 시도 중 [다시 연결]은 눌러도 된다(다음 시도를 바로 시작). 시도 중에는 끊긴 손 점이 맥동하고 문구 앞에 스피너가 돈다.
// 복귀(reconnected)하면 점 둘이 초록, 제목 「재연결 성공!」, 버튼 없음. 재정렬이 필요하면(realign) 상태 문구 자리에 스네어 프롬프트(PLAY-004 D12).
// 버튼은 ref가 필요해 ui/Button 대신 buttonClassName 모양을 입힌 button을 쓴다.
// 재연결 상태(status)는 store/reconnectStore가 정한 값을 호출부가 넘긴다. 이 컴포넌트는 props만 받는다.
import type { Ref } from 'react';
import { RealignPrompt, type RealignInfo } from '@/components/calibration/RealignPrompt';
import { DEVICE_META, DISCONNECTED_TEXT, CONNECTED_TEXT, disconnectTitle, type DeviceId } from '@/domain/kit/device/devices';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import '@/components/ui/action/Button.css';
import '@/components/stick/DisconnectNotice.css';

export interface ReconnectInfo {
  status: 'idle' | 'trying' | 'failed' | 'reconnected';
  attempt: number;
  max: number;
  /** failed일 때 문구 뒤 줄에 보일 소스별 안내(예: 동글을 뺐다 다시 꽂아 주세요) */
  hint?: string;
}

interface Props {
  /** 왼손·오른손 스틱 연결 여부 */
  left: boolean;
  right: boolean;
  /** 페달 연결 여부. undefined면 P 점·문구를 그리지 않는다(동글이 아닌 소스) */
  pedal?: boolean;
  status: ReconnectInfo;
  onExit: () => void;
  /** 없으면 [다시 연결] 버튼을 숨긴다(연결 동작이 없는 소스) */
  onReconnect?: () => void;
  /** 재연결에 실패했을 때 [드럼 세팅에서 연결하기]가 부른다 */
  onOpenSetup?: () => void;
  /** 열릴 때 초점을 받을 주 버튼 ref */
  primaryRef?: Ref<HTMLButtonElement>;
  /** reconnected일 때 스네어 재정렬이 걸려 있으면 상태 문구 대신 프롬프트를 보인다 */
  realign?: RealignInfo | null;
}

function statusText(status: ReconnectInfo): string {
  if (status.status === 'trying') return `연주를 멈췄어요. 다시 연결하는 중… (${status.attempt}/${status.max})`;
  if (status.status === 'reconnected') return '3초 뒤 이어서 연주해요';
  if (status.status === 'failed') return '연결하지 못했어요.';
  return '연주를 멈췄어요. 다시 연결되면 이어서 할 수 있어요.';
}

function Dot({ device, connected, pulse }: { device: DeviceId; connected: boolean; pulse?: boolean }) {
  return (
    <div className="stick-dot-wrap">
      <span className={`stick-dot ${connected ? 'on' : 'off'}${pulse && !connected ? ' pulse' : ''}`} aria-hidden="true">
        {DEVICE_META[device].mark}
      </span>
      <span className="stick-dot-label">{connected ? CONNECTED_TEXT : DISCONNECTED_TEXT}</span>
    </div>
  );
}

export function DisconnectNotice({ left, right, pedal, status, onExit, onReconnect, onOpenSetup, primaryRef, realign }: Props) {
  const failed = status.status === 'failed';
  const trying = status.status === 'trying';
  const reconnected = status.status === 'reconnected';
  return (
    <div
      className="stick-disconnect motion-dialog"
      role={reconnected ? 'status' : 'alertdialog'}
      aria-modal={reconnected ? undefined : 'true'}
      aria-labelledby="stick-disconnect-title"
    >
      <div className="stick-dots">
        <Dot device="LEFT" connected={reconnected || left} pulse={trying} />
        <Dot device="RIGHT" connected={reconnected || right} pulse={trying} />
        {pedal !== undefined && <Dot device="PEDAL" connected={reconnected || pedal} pulse={trying} />}
      </div>
      <h2 id="stick-disconnect-title" className={`stick-disconnect-title${reconnected ? ' good' : ''}`}>
        {reconnected ? '재연결 성공!' : disconnectTitle(left, right, pedal)}
      </h2>
      {reconnected && realign ? (
        <RealignPrompt hands={realign.hands} done={realign.done} unstable={realign.unstable} variant="card" onSkip={realign.onSkip} />
      ) : (
        <p className="stick-disconnect-status" role={reconnected ? undefined : 'status'}>
          {trying && <span className="stick-spinner" aria-hidden="true" />}
          <span>
            {statusText(status)}
            {failed && (
              <>
                <br />
                {status.hint ?? '드럼 세팅에서 연결해 주세요.'}
              </>
            )}
          </span>
        </p>
      )}
      {!reconnected && (
        <div className="stick-disconnect-actions">
          <button type="button" className={buttonClassName({ variant: 'secondary', className: 'stick-disconnect-btn' })} onClick={onExit}>
            나가기
          </button>
          {failed && onOpenSetup ? (
            <button
              ref={primaryRef}
              type="button"
              className={buttonClassName({ className: 'stick-disconnect-btn wide' })}
              onClick={onOpenSetup}
            >
              드럼 세팅에서 연결하기
            </button>
          ) : (
            onReconnect && (
              <button
                ref={primaryRef}
                type="button"
                className={buttonClassName({ className: 'stick-disconnect-btn' })}
                onClick={onReconnect}
              >
                다시 연결
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
