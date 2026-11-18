// Dock 녹음 버튼 (설계 REC-001 6-2, Figma Navigation / DockRecord 523:31016).
// 라우트(useLocation)와 녹음 스토어 상태로 변형을 정하고, 상태는 보관하지 않는다.
// 변형: idle / recording / armed / locked-on / locked-off. 저장 창이 열린 동안은 locked-off 모양 + disabled(U11).
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { startFree, stopFree, toggleArm, useRecordingStore, type RecordingPhase } from '@/runtime/recordingStore';
import { formatElapsed } from '@/domain/time/formatTime';
import { recordButtonVisible } from './recordButtonRoute';
import './recording.css';

type Variant = 'idle' | 'recording' | 'armed' | 'locked-on' | 'locked-off';

function inSaveWindow(phase: RecordingPhase): boolean {
  return phase === 'pendingSave' || phase === 'saving' || phase === 'failed';
}

function variantOf(pathname: string, phase: RecordingPhase, locked: boolean): Variant {
  if (inSaveWindow(phase)) return 'locked-off';
  if (pathname === '/free') return phase === 'recording' ? 'recording' : 'idle';
  if (phase === 'armed') return locked ? 'locked-on' : 'armed';
  return locked ? 'locked-off' : 'idle';
}

export function RecordButton() {
  const { pathname } = useLocation();
  const phase = useRecordingStore((s) => s.phase);
  const locked = useRecordingStore((s) => s.locked);
  const startPerfMs = useRecordingStore((s) => s.free?.startPerfMs ?? null);
  const visible = recordButtonVisible(pathname);
  const variant = variantOf(pathname, phase, locked);
  const [nowMs, setNowMs] = useState(() => performance.now());

  // 녹음 중일 때만 1초마다 현재 시각을 갱신해 경과 시간을 다시 계산한다(첫 1초는 시작 전 시각이면 00:00)
  useEffect(() => {
    if (variant !== 'recording') return;
    const id = setInterval(() => setNowMs(performance.now()), 1000);
    return () => clearInterval(id);
  }, [variant]);

  if (!visible) return null;

  const isFree = pathname === '/free';
  const saveOpen = inSaveWindow(phase);
  const disabled = saveOpen || variant === 'locked-on' || variant === 'locked-off';
  const pressed = variant === 'recording' || variant === 'armed' || variant === 'locked-on';

  let label: string;
  switch (variant) {
    case 'recording':
      label = `녹음 중 · ${formatElapsed(startPerfMs === null ? 0 : nowMs - startPerfMs)}`;
      break;
    case 'armed':
      label = '녹음 켬';
      break;
    case 'locked-on':
      label = '녹음 중';
      break;
    default:
      label = '녹음';
  }

  let ariaLabel: string;
  if (saveOpen) ariaLabel = '저장 중엔 녹음을 바꿀 수 없어요';
  else if (variant === 'locked-on' || variant === 'locked-off') ariaLabel = '연주 중엔 녹음을 바꿀 수 없어요';
  else if (variant === 'recording') ariaLabel = '녹음 정지';
  else if (variant === 'armed') ariaLabel = '녹음 끄기';
  else ariaLabel = isFree ? '녹음 시작' : '녹음 켜기';

  // 마우스로 누른 뒤 포커스가 버튼에 남으면 키보드 킥(Space)이 버튼을 다시 눌러 녹음을 끊는다. 눌렀으면 포커스를 뺀다
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (disabled) return;
    if (isFree) {
      if (variant === 'recording') stopFree('user');
      else if (variant === 'idle') startFree();
      return;
    }
    toggleArm();
  };

  return (
    <button type="button" className={`rec-btn ${variant}`} aria-pressed={pressed} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-btn-label">{label}</span>
    </button>
  );
}
