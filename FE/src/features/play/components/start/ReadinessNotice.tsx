// 준비 조건 미비 안내. 자기 완결 — useSettings·useLive로 readiness를 계산해 미비일 때만 문구와 "설정으로" 버튼을 그린다.
import { useNavigate } from 'react-router-dom';
import { READINESS_MESSAGES, stickMissingText } from '@/domain/kit/device/readiness';
import { useReadiness } from './useReadiness';
import { useLive } from '@/store/liveStore';

interface Props {
  /** 설정 완료 뒤 돌아올 경로(pathname + search) */
  returnTo: string;
  /** 설정 화면 띠에 보일 돌아갈 곳 이름(예: "악보 연습 · 별빛 산책"). 없으면 설정이 경로로 이름을 짓는다 */
  returnLabel?: string;
  compact?: boolean;
}

export function ReadinessNotice({ returnTo, returnLabel, compact }: Props) {
  const navigate = useNavigate();
  const { ready, missing } = useReadiness();
  const connected = useLive((l) => l.connected);
  if (ready) return null;

  return (
    <div className={`notice readiness${compact ? ' compact' : ''}`} role="status">
      <ul className="readiness-list">
        {missing.map((m) => (
          <li key={m}>{m === 'stick' ? stickMissingText(connected) : READINESS_MESSAGES[m]}</li>
        ))}
      </ul>
      <button className="btn-primary small" onClick={() => navigate('/setup', { state: returnLabel ? { returnTo, returnLabel } : { returnTo } })}>
        설정으로
      </button>
    </div>
  );
}
