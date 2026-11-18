// 녹화 재생 바: 재생 모드에서만 상단 바 아래에 보인다. 재생·일시정지, 처음부터, 배속, 진행(경과/전체), 파일 이름, 닫기.
import { REPLAY_SPEEDS, type ReplaySpeed } from '@/features/monitor/core/recording/replay';

/** ms → m:ss */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ReplayBarStatus {
  state: 'paused' | 'playing' | 'ended';
  speed: ReplaySpeed;
  elapsedMs: number;
  totalMs: number;
}

export function ReplayBar({
  name,
  status,
  onToggle,
  onRestart,
  onSpeed,
  onClose,
}: {
  name: string;
  status: ReplayBarStatus;
  onToggle: () => void;
  onRestart: () => void;
  onSpeed: (s: ReplaySpeed) => void;
  onClose: () => void;
}) {
  const label = status.state === 'playing' ? '일시정지' : status.state === 'ended' ? '다시 재생' : '재생';
  return (
    <div className="mon-replay" role="group" aria-label="녹화 재생">
      <span className="badge">녹화 재생</span>
      <span className="mon-replay-name" title={name}>
        {name}
      </span>
      <button className="btn-primary small" onClick={onToggle}>
        {label}
      </button>
      <button className="btn-ghost small" onClick={onRestart}>
        처음부터
      </button>
      <span className="mon-replay-speed" role="group" aria-label="배속">
        {REPLAY_SPEEDS.map((s) => (
          <button key={s} className={s === status.speed ? 'btn-primary small' : 'btn-ghost small'} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </span>
      <progress className="mon-replay-bar" max={Math.max(1, status.totalMs)} value={status.elapsedMs} aria-label="재생 진행" />
      <span className="mon-replay-time">
        {fmtClock(status.elapsedMs)} / {fmtClock(status.totalMs)}
      </span>
      <button className="btn-ghost small" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}
