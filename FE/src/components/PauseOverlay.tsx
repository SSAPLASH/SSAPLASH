// 악보 연주 일시정지 다이얼로그 (MODE-003 설계 4-3, Claude Design Pause 보드). 사유 문구 + 재개·처음부터·나가기.
// 재개는 준비 조건이 충족될 때만 활성이다(canResume). 아니면 미비 안내 띠를 함께 보인다.
// 스크림·다이얼로그 색은 .sheet-mode 밖에서도 보이도록 클래스에 직접 둔다.
import { ReadinessNotice } from '@/components/ReadinessNotice';
import { formatSongTime } from '@/components/formatTime';

export type PauseReason = 'user' | 'disconnected' | 'menu';

interface Props {
  reason: PauseReason;
  canResume: boolean;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  /** 설정으로 갔다 돌아올 경로(pathname + search) */
  returnTo: string;
  /** 멈춘 곡 시각(ms). 주어지면 설명에 m:ss.d로 보인다 */
  pausedAtMs?: number;
}

const TITLE: Record<PauseReason, string> = {
  user: '일시정지',
  disconnected: '스틱 연결이 끊겼습니다',
  menu: '메뉴를 열어 일시정지했습니다',
};

function describe(reason: PauseReason, pausedAtMs?: number): string {
  const at = pausedAtMs !== undefined ? `${formatSongTime(pausedAtMs)}에서 ` : '';
  const stop = `연주·반주·클릭을 ${at}멈췄습니다.`;
  if (reason === 'disconnected') return `${stop} 다시 연결되면 그 자리에서 이어집니다.`;
  return `${stop} 재개하면 그 자리에서 이어집니다.`;
}

function Icon({ reason }: { reason: PauseReason }) {
  if (reason === 'disconnected') {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M10 4l7.5 13h-15z" />
        <path d="M10 9v3.5M10 14.5v.5" />
      </svg>
    );
  }
  if (reason === 'menu') {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h12M4 10h12M4 14h12" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <rect x="5" y="4" width="3.5" height="12" rx="1" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
    </svg>
  );
}

export function PauseOverlay({ reason, canResume, onResume, onRestart, onLeave, returnTo, pausedAtMs }: Props) {
  return (
    <div className="sm-scrim">
      <div className="sm-dialog pause-dialog" role="dialog" aria-label="일시정지">
        <div>
          <div className="pause-title">
            <span className={`pause-ico ${reason === 'disconnected' ? 'danger' : 'info'}`} aria-hidden="true">
              <Icon reason={reason} />
            </span>
            <h2>{TITLE[reason]}</h2>
          </div>
          <p className="pause-desc">{describe(reason, pausedAtMs)}</p>
        </div>
        {!canResume && (
          <div className="pause-warn">
            <span className="pause-dot" aria-hidden="true" />
            <ReadinessNotice returnTo={returnTo} compact />
          </div>
        )}
        <div className="pause-actions">
          <button className="sm-btn primary lg" onClick={onResume} disabled={!canResume}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6 4l10 6-10 6z" />
            </svg>
            재개 <span className="sm-key">Enter</span>
          </button>
          <button className="sm-btn lg" style={{ fontWeight: 400 }} onClick={onRestart}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M4 10a6 6 0 1 1 1.8 4.3" />
              <path d="M4 15v-5h5" />
            </svg>
            처음부터
          </button>
          <button className="sm-btn danger-outline lg pause-leave" style={{ fontWeight: 400 }} onClick={onLeave}>
            나가기
          </button>
        </div>
        <span className="pause-foot">나가면 이번 연주는 기록되지 않습니다. 처음부터는 카운트인부터 다시 시작합니다.</span>
      </div>
    </div>
  );
}
