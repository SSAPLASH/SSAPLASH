// 일시정지 다이얼로그 (Figma PauseDialog 112:592) · 연결 끊김 카드 (사유 disconnected, stick/DisconnectNotice 228:1138).
// 재개는 준비 조건이 충족될 때만 활성이다(canResume). 아니면 다이얼로그 안에 준비 미비 문구(ReadinessNotice)를 함께 보인다.
// 포커스 규칙(D3·D4): 열릴 때 주 버튼, Tab 순환, Esc = 계속, 닫힐 때 body로(returnFocus 'blur' — 연주 중 Space 킥 보호).
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReadinessNotice } from '@/features/play/components/start/ReadinessNotice';
import { DisconnectNotice } from '@/features/play/components/pause/DisconnectNotice';
import type { RealignInfo } from '@/components/calibration/RealignPrompt';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import '@/components/ui/action/Button.css';
import { Slider } from '@/components/ui/form/Slider';
import { useDialogFocus } from '@/components/ui/overlay/useDialogFocus';
import { SoundIcon } from '@/components/shell/dock/SoundIcon';
import { useDockRaised } from '@/components/shell/nav/useShell';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';
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
  /** reconnected 카드에 끼울 스네어 재정렬 프롬프트(PLAY-004 D12). 없으면 「3초 뒤 이어서 연주해요」 */
  realign?: RealignInfo | null;
  /** 곡에 반주(드럼리스 MR)가 있는지. 없으면 노래 음량 슬라이더를 끄고 안내한다(기본 있음) */
  hasAccompaniment?: boolean;
}

export function PauseOverlay({ reason, canResume, onResume, onRestart, onLeave, returnTo, realign, hasAccompaniment = true }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const connected = useLive((l) => l.connected);
  const pedalPair = useLive((l) => l.pedal.connected);
  const sensorKind = useSettings((s) => s.sensorKind);
  // 동글 소스만 페달을 본다(undefined면 끊김 카드가 P 점을 그리지 않는다)
  const pedal = pedalRequired(sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined;
  const drumVolume = useSettings((s) => s.drumVolume);
  const setDrumVolume = useSettings((s) => s.setDrumVolume);
  const songVolume = useSettings((s) => s.songVolume);
  const setSongVolume = useSettings((s) => s.setSongVolume);
  // 팝업이 떠 있는 동안 Dock을 스크림 위로 올린다(Q9). 끊김 카드도 같은 컴포넌트라 함께 적용된다
  useDockRaised();
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
            pedal={pedal}
            status={reconnected ? { status: 'reconnected', attempt: 0, max } : { status: reconnectState, attempt, max, hint }}
            onExit={onLeave}
            onReconnect={available ? () => void reconnect() : undefined}
            onOpenSetup={() => navigate('/setup', { state: { returnTo } })}
            primaryRef={primaryRef}
            realign={realign}
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
            {/* 소리 묶음: 설정 화면과 같은 값·범위. 슬라이더는 role=dialog 안이라 모든 키를 소유해 드럼 타격으로 새지 않는다 */}
            <section className="play-pause-sound" aria-label="소리">
              <h3 className="play-pause-sound-title">소리</h3>
              <Slider
                label="드럼 음량"
                min={0}
                max={2}
                step={0.05}
                value={drumVolume}
                valueText={`${Math.round(drumVolume * 100)}%`}
                onChange={setDrumVolume}
                leading={<SoundIcon on={false} />}
                trailing={<SoundIcon on />}
              />
              <div className="play-pause-sound-divider" aria-hidden="true" />
              <Slider
                label="노래 음량(반주)"
                className={hasAccompaniment ? undefined : 'play-pause-sound-off'}
                min={0}
                max={1}
                step={0.05}
                value={songVolume}
                valueText={`${Math.round(songVolume * 100)}%`}
                onChange={setSongVolume}
                disabled={!hasAccompaniment}
                leading={<SoundIcon on={false} />}
                trailing={<SoundIcon on />}
              />
              {!hasAccompaniment && <p className="play-pause-sound-note">이 곡은 반주가 없어요</p>}
            </section>
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
              <button type="button" className={buttonClassName({ variant: 'secondary', fullWidth: true, className: 'play-pause-restart' })} onClick={onRestart}>
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
