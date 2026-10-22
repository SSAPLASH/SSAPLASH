// 악보 연주 일시정지 오버레이 (MODE-003 설계 4-3). 사유 문구 + 재개·재시작·나가기.
// 재개는 준비 조건이 충족될 때만 활성이다(canResume). 아니면 미비 안내를 함께 보인다.
import { ReadinessNotice } from '@/components/ReadinessNotice';

export type PauseReason = 'user' | 'disconnected' | 'menu';

interface Props {
  reason: PauseReason;
  canResume: boolean;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  /** 설정으로 갔다 돌아올 경로(pathname + search) */
  returnTo: string;
}

const TITLE: Record<PauseReason, string> = {
  user: '일시정지',
  disconnected: '스틱 연결이 끊겼습니다',
  menu: '메뉴를 열어 일시정지했습니다',
};

export function PauseOverlay({ reason, canResume, onResume, onRestart, onLeave, returnTo }: Props) {
  return (
    <div className="overlay pause-overlay" role="dialog" aria-label="일시정지">
      <h2>{TITLE[reason]}</h2>
      {!canResume && <ReadinessNotice returnTo={returnTo} compact />}
      <div className="row pause-actions">
        <button className="btn-primary" onClick={onResume} disabled={!canResume}>
          재개 (Enter)
        </button>
        <button className="btn-ghost" onClick={onRestart}>
          처음부터
        </button>
        <button className="btn-danger" onClick={onLeave}>
          나가기
        </button>
      </div>
      <p className="small faint">나가면 이번 연주는 기록되지 않습니다.</p>
    </div>
  );
}
