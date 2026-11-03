// 일시정지 다이얼로그 (Figma PauseDialog 112:592) · 연결 끊김 카드 (사유 disconnected, stick/DisconnectNotice 228:1138).
// 재개는 준비 조건이 충족될 때만 활성이다(canResume). 아니면 다이얼로그 안에 준비 미비 문구(ReadinessNotice)를 함께 보인다.
// 포커스 규칙(D3·D4): 열릴 때 주 버튼, Tab 순환, Esc = 계속, 닫힐 때 body로(returnFocus 'blur' — 연주 중 Space 킥 보호).
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReadinessNotice } from '@/components/ReadinessNotice';
import { DisconnectNotice } from '@/components/stick/DisconnectNotice';
import { buttonClassName } from '@/components/ui/buttonStyle';
import '@/components/ui/Button.css';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { useLive } from '@/store/liveStore';
import { useReconnect } from '@/store/reconnectStore';
import './PauseOverlay.css';

// reconnected: 끊김에서 복귀한 직후 약 1초(「재연결 성공!」). 페이지가 정하고, 버튼이 없다(useReconnectResume)
export type PauseReason = 'user' | 'disconnected' | 'reconnected' | 'menu';

interface Props {
  reason: PauseReason;
  canResume: boolean;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  /** 설정으로 갔다 돌아올 경로(pathname + search) */
  returnTo: string;
  /** 멈춘 곡 시각(ms). 지금 화면에는 쓰지 않지만 호출부 계약을 유지한다 */
  pausedAtMs?: number;
}

export function PauseOverlay({ reason, canResume, onResume, onRestart, onLeave, returnTo }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const connected = useLive((l) => l.connected);
  const reconnectState = useReconnect((s) => s.status);
  const attempt = useReconnect((s) => s.attempt);
  const max = useReconnect((s) => s.max);
  const available = useReconnect((s) => s.available);
  const reconnect = useReconnect((s) => s.reconnect);
  const hint = useReconnect((s) => s.hint);

  // 닫힐 때 body로 보낸다(D3): 이전 버튼으로 복원하면 Space(킥)가 그 버튼을 눌러 다시 멈춘다
  useDialogFocus({
    open: true,
    dialogRef,
    initialRef: primaryRef,
    onEscape: canResume && reason !== 'reconnected' ? onResume : undefined,
    returnFocus: 'blur',
  });

  // reconnected 카드는 페이지가 정한 reason을 따른다(스토어의 reconnected는 1초 뒤 idle로 돌아간다)
  const reconnected = reason === 'reconnected';
  const disconnected = reason === 'disconnected' || reconnected;
  return (
    <div className="play-pause-scrim motion-overlay">
      <div ref={dialogRef} className="play-pause-wrap">
        {disconnected ? (
          <DisconnectNotice
            left={connected[0]}
            right={connected[1]}
            status={reconnected ? { status: 'reconnected', attempt: 0, max } : { status: reconnectState, attempt, max, hint }}
            onExit={onLeave}
            onReconnect={available ? () => void reconnect() : undefined}
            onOpenSetup={() => navigate('/setup', { state: { returnTo } })}
            primaryRef={primaryRef}
          />
        ) : (
          <div className="play-pause motion-dialog" role="dialog" aria-modal="true" aria-labelledby="play-pause-title">
            <div className="play-pause-head">
              <h2 id="play-pause-title" className="play-pause-title">
                일시정지
              </h2>
              <p className="play-pause-sub">잠시 쉬어가도 괜찮아요</p>
            </div>
            {!canResume && (
              <div className="play-pause-warn">
                <ReadinessNotice returnTo={returnTo} compact />
              </div>
            )}
            <div className="play-pause-actions">
              <button
                ref={primaryRef}
                type="button"
                className={buttonClassName({ fullWidth: true })}
                onClick={onResume}
                disabled={!canResume}
              >
                계속
              </button>
              <button type="button" className={buttonClassName({ variant: 'secondary', fullWidth: true })} onClick={onRestart}>
                다시 시작
              </button>
              <button type="button" className={buttonClassName({ variant: 'secondary', fullWidth: true })} onClick={onLeave}>
                나가기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
