// 연결 끊김 카드 (Figma Play / DisconnectNotice 228:1138, 10/31 재구성). 420 카드 안에 L·R 연결 점, 제목, 재연결 상태 문구, 버튼 둘.
// 시도 중에는 초점을 잃지 않게 disabled 대신 aria-disabled(스토어가 중복 호출을 무시한다).
// 버튼은 ref가 필요해 ui/Button 대신 buttonClassName 모양을 입힌 button을 쓴다.
// 재연결 상태(status)는 store/reconnectStore가 정한 값을 호출부가 넘긴다. 이 컴포넌트는 props만 받는다.
import type { Ref } from 'react';
import { buttonClassName } from '@/components/ui/buttonStyle';
import '@/components/ui/Button.css';
import './DisconnectNotice.css';

export interface ReconnectInfo {
  status: 'idle' | 'trying' | 'failed';
  attempt: number;
  max: number;
}

interface Props {
  /** 왼손·오른손 스틱 연결 여부 */
  left: boolean;
  right: boolean;
  status: ReconnectInfo;
  onExit: () => void;
  /** 없으면 [다시 연결] 버튼을 숨긴다(연결 동작이 없는 소스) */
  onReconnect?: () => void;
  /** 재연결에 실패했을 때 [드럼 세팅에서 연결하기]가 부른다 */
  onOpenSetup?: () => void;
  /** 열릴 때 초점을 받을 주 버튼 ref */
  primaryRef?: Ref<HTMLButtonElement>;
}

function titleText(left: boolean, right: boolean): string {
  if (!left && !right) return '양손 스틱 연결이 끊겼어요';
  return `${left ? '오른손' : '왼손'} 스틱 연결이 끊겼어요`;
}

function statusText(status: ReconnectInfo): string {
  if (status.status === 'trying') return `연주를 멈췄어요. 다시 연결하는 중… (${status.attempt}/${status.max})`;
  if (status.status === 'failed') return '연결하지 못했어요. 드럼 세팅에서 연결해 주세요.';
  return '연주를 멈췄어요. 다시 연결되면 이어서 할 수 있어요.';
}

function Dot({ hand, connected }: { hand: 'L' | 'R'; connected: boolean }) {
  return (
    <div className="stick-dot-wrap">
      <span className={`stick-dot ${connected ? 'on' : 'off'}`} aria-hidden="true">
        {hand}
      </span>
      <span className="stick-dot-label">{connected ? '연결됨' : '끊김'}</span>
    </div>
  );
}

export function DisconnectNotice({ left, right, status, onExit, onReconnect, onOpenSetup, primaryRef }: Props) {
  const failed = status.status === 'failed';
  const trying = status.status === 'trying';
  return (
    <div className="stick-disconnect motion-dialog" role="alertdialog" aria-modal="true" aria-labelledby="stick-disconnect-title">
      <div className="stick-dots">
        <Dot hand="L" connected={left} />
        <Dot hand="R" connected={right} />
      </div>
      <h2 id="stick-disconnect-title" className="stick-disconnect-title">
        {titleText(left, right)}
      </h2>
      <p className="stick-disconnect-status" role="status">
        {statusText(status)}
      </p>
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
              aria-disabled={trying}
            >
              다시 연결
            </button>
          )
        )}
      </div>
    </div>
  );
}
